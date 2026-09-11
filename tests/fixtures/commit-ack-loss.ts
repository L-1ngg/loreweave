import net from "node:net";
/** Transparent PostgreSQL wire fault: let COMMIT reach the real server, drop its
 * acknowledgement only for a transaction containing the selected domain effect.
 * No domain method, transaction or query result is replaced. Test databases only. */
export async function commitAckLoss(databaseUrl: string, domain: RegExp) {
  const target = new URL(databaseUrl);
  const upstreamHost = target.hostname,
    upstreamPort = Number(target.port || 5432);
  const sockets = new Set<net.Socket>();
  let dropped = false;
  const server = net.createServer((client) => {
    const upstream = net.connect(upstreamPort, upstreamHost);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(client);
    sockets.add(upstream);
    let startup = true;
    let effect = false;
    let receipt = false;
    const prepared = new Map<string, string>();
    let front = Buffer.alloc(0);
    let back = Buffer.alloc(0);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      socket.on("error", close);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    }
    client.on("data", (data) => {
      front = Buffer.concat([front, data]);
      while (front.length >= (startup ? 4 : 5)) {
        const length = startup
          ? front.readInt32BE(0)
          : front.readInt32BE(1) + 1;
        if (front.length < length) break;
        const frame = front.subarray(0, length);
        front = front.subarray(length);
        if (!startup) {
          const type = String.fromCharCode(frame[0]!);
          const fields = frame.toString("utf8", 5).split("\0");
          if (type === "P") prepared.set(fields[0]!, fields[1]!);
          const query =
            type === "B"
              ? prepared.get(fields[1]!)
              : type === "Q"
                ? fields[0]
                : undefined;
          if (query) {
            if (/^begin\b/i.test(query)) {
              effect = false;
              receipt = false;
            }
            if (domain.test(query)) effect = true;
            if (query.includes("INSERT INTO knowledge_job_commits"))
              receipt = true;
          }
        }
        startup = false;
        upstream.write(frame);
      }
    });
    upstream.on("data", (data) => {
      back = Buffer.concat([back, data]);
      while (back.length >= 5) {
        const length = back.readInt32BE(1) + 1;
        if (back.length < length) break;
        const frame = back.subarray(0, length);
        back = back.subarray(length);
        if (
          !dropped &&
          effect &&
          receipt &&
          frame[0] === 67 &&
          frame.toString("utf8", 5) === "COMMIT\0"
        ) {
          dropped = true;
          close();
          return;
        }
        client.write(frame);
      }
    });
    client.on("end", () => upstream.end());
    upstream.on("end", () => client.end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("proxy unavailable");
  target.hostname = "127.0.0.1";
  target.port = String(address.port);
  return {
    url: target.toString(),
    get dropped() {
      return dropped;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
