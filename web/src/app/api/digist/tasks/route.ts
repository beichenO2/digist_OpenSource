import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/digist-data";
import { getDataDir, digistExecEnv } from "@/lib/digist-paths";
import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";

export async function GET() {
  try {
    const tasks = getStorage().listTasks(100);
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, params } = body;

    if (!type || !["crawl", "compile_wiki", "generate_report", "preprocess"].includes(type)) {
      return NextResponse.json(
        { ok: false, error: `Invalid task type. Must be: crawl, compile_wiki, generate_report, preprocess` },
        { status: 400 },
      );
    }

    const task = getStorage().createTask(type, params || {});

    // Fire-and-forget background execution
    executeTaskInBackground(task.id, type, params || {});

    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

const DIGIST_API = process.env.DIGIST_API_URL || "http://127.0.0.1:3800";
const DIGIST_ROOT = join(process.cwd(), "..");
const execFileAsync = promisify(execFile);

async function runTsx(
  script: string,
  timeout = 600_000,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr?: string }> {
  const { stdout, stderr } = await execFileAsync("npx", ["tsx", "-e", script], {
    cwd: DIGIST_ROOT,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: digistExecEnv({
      DIGIST_DATA_DIR: getDataDir(),
      DIGIST_DB: process.env.DIGIST_DB || join(getDataDir(), "digist.sqlite"),
      ...extraEnv,
    }),
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() || undefined };
}

async function runDigistCli(args: string[], timeout = 600_000): Promise<{ stdout: string; stderr?: string }> {
  const { stdout, stderr } = await execFileAsync("npx", ["tsx", "src/cli.ts", ...args], {
    cwd: DIGIST_ROOT,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: digistExecEnv({
      DIGIST_DATA_DIR: getDataDir(),
      DIGIST_DB: process.env.DIGIST_DB || join(getDataDir(), "digist.sqlite"),
    }),
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() || undefined };
}

async function executeTaskInBackground(taskId: string, type: string, params: Record<string, unknown>) {
  const storage = getStorage();

  setTimeout(async () => {
    storage.updateTask(taskId, { status: "running" });

    try {
      let result: unknown;

      switch (type) {
        case "crawl": {
          const platform = String(params.platform || "");
          const query = String(params.query || "");
          if (!platform) {
            result = { error: "platform is required" };
            break;
          }
          const resp = await fetch(`${DIGIST_API}/api/crawl/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform, query }),
            signal: AbortSignal.timeout(120_000),
          });
          result = await resp.json();
          break;
        }
        case "compile_wiki": {
          result = await runDigistCli(["compile-wiki"]);
          break;
        }
        case "generate_report": {
          const limit = Math.min(500, Math.max(10, Number(params.limit) || 200));
          const topic = typeof params.topic === "string" && params.topic.trim()
            ? params.topic.trim()
            : undefined;
          const script = `
            const { mkdirSync, writeFileSync } = await import("node:fs");
            const { join } = await import("node:path");
            const { Storage } = await import("./src/storage/" + "index.ts");
            const { generateFusionReport } = await import("./src/fusion/" + "report-generator.ts");
            const limit = Number(process.env.DIGIST_TASK_LIMIT || "200");
            const topic = process.env.DIGIST_TASK_TOPIC || undefined;
            const dataDir = process.env.DIGIST_DATA_DIR || "./data";
            const storage = new Storage(process.env.DIGIST_DB || "./data/digist.sqlite");
            try {
              const items = storage.listContent(undefined, limit, 0);
              if (items.length === 0) throw new Error("No content items available for report generation");
              const report = generateFusionReport(items, topic);
              const reportDir = join(dataDir, "reports");
              mkdirSync(reportDir, { recursive: true });
              const safeTopic = (topic || "dashboard-report").replace(/[^\\w\\u4e00-\\u9fff-]+/g, "-");
              const filename = \`\${safeTopic}-\${new Date().toISOString().replace(/[:.]/g, "-")}.md\`;
              writeFileSync(join(reportDir, filename), report.full_markdown, "utf-8");
              console.log(JSON.stringify({
                filename,
                title: report.title,
                sources: report.sources.length,
                insights: report.key_insights.length,
                conflicts: report.conflicts_summary.length,
              }));
            } finally {
              storage.close();
            }
          `;
          result = await runTsx(script, 600_000, {
            DIGIST_TASK_LIMIT: String(limit),
            DIGIST_TASK_TOPIC: topic || "",
          }).then((out) => {
            try {
              return JSON.parse(out.stdout);
            } catch {
              return out;
            }
          });
          break;
        }
        case "preprocess": {
          const file = String(params.file || "");
          const preprocessType = String(params.type || "");
          if (!file || !["pdf", "audio", "video"].includes(preprocessType)) {
            throw new Error("file and type (pdf|audio|video) are required");
          }

          const script = `
            const { mkdirSync, writeFileSync } = await import("node:fs");
            const { basename, extname, join } = await import("node:path");
            const file = process.env.DIGIST_PREPROCESS_FILE;
            const type = process.env.DIGIST_PREPROCESS_TYPE;
            const domain = process.env.DIGIST_PREPROCESS_DOMAIN || "general";
            const outputDir = join(process.env.DIGIST_DATA_DIR || "./data", "preprocessed");
            mkdirSync(outputDir, { recursive: true });
            if (!file) throw new Error("file is required");
            let converted;
            let outputPath;
            if (type === "pdf") {
              const { savePdfAsMarkdown } = await import("./src/preprocess/" + "pdf-to-markdown.ts");
              converted = await savePdfAsMarkdown(file, outputDir);
            } else if (type === "audio") {
              const { audioToMarkdown } = await import("./src/preprocess/" + "audio-to-markdown.ts");
              converted = await audioToMarkdown(file, { outputDir });
              outputPath = join(outputDir, \`\${basename(file, extname(file))}.md\`);
              if (converted.success) writeFileSync(outputPath, converted.markdown, "utf-8");
            } else if (type === "video") {
              const { videoToMarkdown } = await import("./src/preprocess/" + "video-to-markdown.ts");
              converted = await videoToMarkdown(file, { outputDir, domain });
              outputPath = join(outputDir, \`\${basename(file, extname(file))}.md\`);
              if (converted.success) writeFileSync(outputPath, converted.markdown, "utf-8");
            } else {
              throw new Error("type must be pdf, audio, or video");
            }
            if (!converted.success) throw new Error(converted.error || "Preprocessing failed");
            console.log(JSON.stringify({ ...converted, outputDir, outputPath }));
          `;
          const { stdout } = await execFileAsync("npx", ["tsx", "-e", script], {
            cwd: DIGIST_ROOT,
            timeout: 600_000,
            maxBuffer: 20 * 1024 * 1024,
            env: {
              ...process.env,
              DIGIST_DATA_DIR: getDataDir(),
              DIGIST_DB: process.env.DIGIST_DB || join(getDataDir(), "digist.sqlite"),
              DIGIST_PREPROCESS_FILE: file,
              DIGIST_PREPROCESS_TYPE: preprocessType,
              DIGIST_PREPROCESS_DOMAIN: String(params.domain || "general"),
            },
          });
          result = JSON.parse(stdout.trim());
          break;
        }
      }

      storage.updateTask(taskId, { status: "done", result });
    } catch (err) {
      storage.updateTask(taskId, { status: "failed", error: String(err) });
    }
  }, 100);
}
