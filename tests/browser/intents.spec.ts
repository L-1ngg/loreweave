import { test, expect } from "@playwright/test";

test("duplicate manuals require a choice that survives reload and updates only the selected source", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("组织")
    .fill(process.env.LOREWEAVE_BROWSER_ORGANIZATION!);
  await page.getByLabel("用户名", { exact: true }).fill("browser-admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("问题")).toBeVisible();
  const name = `手册-${crypto.randomUUID()}.md`;
  const versions = [];
  const projects = [];
  for (const project of ["项目甲", "项目乙"]) {
    const response = await page.request.post("/api/admin/projects", {
      data: { name: `${project}-${crypto.randomUUID()}` },
    });
    projects.push((await response.json()).project);
  }
  for (const [i, days] of [30, 45].entries()) {
    const uploaded = await (
      await page.request.post("/api/attachments", {
        multipart: {
          projectId: projects[i].id,
          file: {
            name,
            mimeType: "text/markdown",
            buffer: Buffer.from(`生产日志保留 ${days} 天。`),
          },
        },
      })
    ).json();
    const op = await (
      await page.request.post("/api/imports", {
        data: {
          attachmentId: uploaded.id,
          key: crypto.randomUUID(),
          projectId: projects[i].id,
        },
      })
    ).json();
    versions.push(op);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/imports/${op.id}`)).json())
            .source,
      )
      .toBe("searchable");
  }
  await page.getByLabel("Markdown 文件").setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from("生产日志保留 90 天。"),
  });
  await expect(page.getByRole("button", { name: "直接导入" })).toBeEnabled();
  await page.getByLabel("问题").fill(`请用附件更新「${name}」`);
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByTestId("answer")).toContainText("请选择");
  await expect(page.getByTestId("answer")).toContainText(projects[0].name);
  await expect(page.getByTestId("answer")).toContainText(projects[1].name);
  await page.reload();
  await expect(page.getByTestId("answer")).toContainText("请选择");
  const conversationId = new URL(page.url()).searchParams.get("conversation")!;
  const previous = (
    await (
      await page.request.get(`/api/conversations/${conversationId}`)
    ).json()
  ).runs.at(-1);
  const selected = previous.intentContext.pending.candidates[1];
  await page.getByLabel("问题").fill("选择第2个");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByTestId("answer")).toContainText("已受理");
  await page.reload();
  await expect(page.getByTestId("answer")).toContainText("已受理");
  const runs = (
    await (
      await page.request.get(`/api/conversations/${conversationId}`)
    ).json()
  ).runs;
  const opId = runs.at(-1).operations[0];
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/imports/${opId}`)).json()).source,
    )
    .toBe("searchable");
  const updated = await (await page.request.get(`/api/imports/${opId}`)).json();
  expect(updated.documentId).toBe(selected.documentId);
  const other = versions.find((v) => v.documentId !== selected.documentId)!;
  expect(
    (await (await page.request.get(`/api/sources/${other.versionId}`)).json())
      .state,
  ).toBe("active");
  expect(runs.at(-1).operations).toHaveLength(1);
  await expect(page.getByLabel("知识范围")).toHaveValue(selected.projectId);
  await page.getByLabel("Markdown 文件").setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from("生产日志保留 120 天。"),
  });
  await expect(page.getByRole("button", { name: "直接导入" })).toBeEnabled();
  await page.getByLabel("问题").fill("请更新这个文档");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByTestId("answer")).toContainText("已受理");
  const followup = (
    await (
      await page.request.get(`/api/conversations/${conversationId}`)
    ).json()
  ).runs.at(-1);
  expect(
    (
      await (
        await page.request.get(`/api/imports/${followup.operations[0]}`)
      ).json()
    ).documentId,
  ).toBe(selected.documentId);

  let releaseEvents!: () => void;
  const eventsGate = new Promise<void>((resolve) => {
    releaseEvents = resolve;
  });
  await page.route("**/api/runs/*/events", async (route) => {
    await eventsGate;
    await route.continue();
  });
  try {
    await expect(
      page.getByRole("button", { name: "提问", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("问题").fill("日志保留多久？");
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/runs") && response.status() === 202,
    );
    await page.getByRole("button", { name: "提问", exact: true }).click();
    await accepted;
    const otherProject = projects.find(
      (project) => project.id !== selected.projectId,
    );
    await page.getByLabel("知识范围").selectOption(otherProject.id);
    await page.getByLabel("Markdown 文件").setInputFiles({
      name: "next.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("新项目日志保留 10 天。"),
    });
    await expect(page.getByRole("button", { name: "直接导入" })).toBeEnabled();
    releaseEvents();
    await expect(
      page.getByRole("button", { name: "提问", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("知识范围")).toHaveValue(otherProject.id);
    await expect(
      page.getByText("已附加：next.md", { exact: false }),
    ).toBeVisible();
  } finally {
    releaseEvents();
    await page.unroute("**/api/runs/*/events");
  }
});

test("browser restart recovers a committed effect whose run result was never persisted", async ({
  page,
}) => {
  const { spawn } = await import("node:child_process");
  const organization = `restart-${crypto.randomUUID()}`;
  let child: ReturnType<typeof spawn> | undefined;
  async function start(port: number, crash: boolean) {
    child = spawn(
      "bun",
      [
        "--no-env-file",
        "tests/fixtures/intent-restart-server.ts",
        String(port),
        crash ? "crash" : "recover",
      ],
      {
        env: { ...process.env, RESTART_TEST_ORGANIZATION: organization },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const current = child;
    const exited = new Promise<number | null>((resolve) =>
      current.once("exit", resolve),
    );
    let errors = "";
    current.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    const address = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`fixture startup timed out: ${errors}`)),
        10000,
      );
      let output = "";
      current.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      current.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`fixture exited before ready: ${errors}`));
      });
      current.stdout!.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(output.split("\n")[0]!).url);
        }
      });
    });
    return { address, exited };
  }
  try {
    const first = await start(0, true);
    await page.goto(first.address);
    await page.getByLabel("组织").fill(organization);
    await page.getByLabel("用户名", { exact: true }).fill("restart-admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill("restart-test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByLabel("问题")).toBeVisible();
    await page.getByLabel("Markdown 文件").setInputFiles({
      name: "restart.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("生产日志保留 30 天。"),
    });
    await expect(page.getByRole("button", { name: "直接导入" })).toBeEnabled();
    await page.getByLabel("问题").fill("请把附件导入知识库");
    await page.getByRole("button", { name: "提问", exact: true }).click();
    await expect(page).toHaveURL(/conversation=/);
    expect(await first.exited).toBe(89);
    const conversation = new URL(page.url()).searchParams.get("conversation")!;
    await start(Number(new URL(first.address).port), false);
    await page.reload();
    await expect(page.getByTestId("accepted-operations")).toContainText(
      "已受理 1 项知识变更",
    );
    await expect(
      page.getByText("此前执行已中断", { exact: false }),
    ).toBeVisible();
    const response = await page.request.get(
      `${first.address}api/conversations/${conversation}`,
    );
    const runs = (await response.json()).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].operations).toHaveLength(1);
    const operations = await (
      await page.request.get(`${first.address}api/imports`)
    ).json();
    expect(operations.operations).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId("accepted-operations")).toContainText(
      "已受理 1 项知识变更",
    );
    expect(
      (await (await page.request.get(`${first.address}api/imports`)).json())
        .operations,
    ).toHaveLength(1);
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child!.once("exit", () => resolve()),
      );
      child.kill("SIGTERM");
      await exited;
    }
  }
});
