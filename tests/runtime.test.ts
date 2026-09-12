import { expect, test } from "bun:test";
import { createLifecycle } from "../src/lifecycle.ts";
import { createRuntime } from "../src/development/runtime.ts";
import { loadConfig } from "../src/config.ts";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("startup failure releases acquired resources even when one cleanup fails", async () => {
  const closed: string[] = [];
  const failure = new Error("migration_failed");
  const cleanupFailure = new Error("connection_close_failed");
  const runtime = createLifecycle(async ({ defer }) => {
    defer(() => {
      closed.push("first");
    });
    defer(() => {
      closed.push("second");
      throw cleanupFailure;
    });
    throw failure;
  });
  try {
    await runtime.start();
    throw new Error("expected startup failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors[0]).toBe(failure);
    expect(error.errors[1].errors).toEqual([cleanupFailure]);
  }
  expect(closed).toEqual(["second", "first"]);
  await expect(runtime.close()).rejects.toThrow("runtime_cleanup_failed");
  expect(closed).toHaveLength(2);
});

test("repeated close waits for active work before releasing its database", async () => {
  const activeWork = gate();
  const closingWork = gate();
  const closed: string[] = [];
  const runtime = createLifecycle(async ({ signal, defer }) => {
    defer(() => {
      closed.push("database");
    });
    defer(async () => {
      expect(signal.aborted).toBe(true);
      closingWork.resolve();
      await activeWork.promise;
      closed.push("worker");
    });
    defer(() => {
      closed.push("http");
    });
  });
  await runtime.start();
  const first = runtime.close();
  expect(runtime.close()).toBe(first);
  await closingWork.promise;
  expect(closed).toEqual(["http"]);
  activeWork.resolve();
  await first;
  expect(closed).toEqual(["http", "worker", "database"]);
  await expect(runtime.start()).rejects.toThrow("runtime_closed");
});

test("close during startup waits for late resource registration and cleans it", async () => {
  const entered = gate();
  const finishSetup = gate();
  const closed: string[] = [];
  const runtime = createLifecycle(async ({ defer }) => {
    defer(() => {
      closed.push("first");
    });
    entered.resolve();
    await finishSetup.promise;
    defer(() => {
      closed.push("late");
    });
  });
  const starting = runtime.start();
  const outcome = starting.catch(() => "stopped");
  expect(runtime.start()).toBe(starting);
  await entered.promise;
  const closing = runtime.close();
  expect(closed).toEqual([]);
  finishSetup.resolve();
  await closing;
  expect(await outcome).toBe("stopped");
  expect(closed).toEqual(["late", "first"]);
});

test("close before start does not acquire resources", async () => {
  let started = false;
  const runtime = createLifecycle(async () => {
    started = true;
  });
  await runtime.close();
  await expect(runtime.start()).rejects.toThrow("runtime_closed");
  expect(started).toBe(false);
});

test("runtime reports missing database before creating connections or listeners", async () => {
  const runtime = createRuntime(loadConfig({}));
  await expect(runtime.start()).rejects.toThrow("missing_config:DATABASE_URL");
  await runtime.close();
});
