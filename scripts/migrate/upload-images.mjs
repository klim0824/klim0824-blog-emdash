import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const mapPath = path.join(__dirname, "data", "media-map.json");
const repoRoot = path.join(__dirname, "..", "..");
const emdashCli = path.join(
  repoRoot,
  "node_modules/.pnpm/emdash@0.30.0_@astrojs+react@6.0.2_@types+node@26.2.0_@types+react-dom@19.2.4_@types+re_67d5210a1b3a63daab779787f3f57c9a/node_modules/emdash/dist/cli/index.mjs"
);

// Tag icon URLs (same 16 as seed/seed.json's content.tag_icons).
const TAG_ICON_URLS = [
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/01079630bc9c4373909c76d062b10dca/microcms.png",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/3468e65f9dba4fe2b104d3d20b211c45/react.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/7ef5887e5ba04725a74c314143c6d309/nextjs.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/101acfae25f343f68a2954b3851388b0/nodejs.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/046572aeb14c4596911bac98ae3f2a30/typescript.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/620d79bd12ae495ba0211b09846d636e/javascript.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/0f5931e4ccd4451ea98b7a83df25a761/homebrew.png",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/56bc04dd4dc64da8940878814562ada0/windows.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/5c275cee47284790812827a93526f23b/apple.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/f835c477b6774349bf0b68ee49cb51c3/sourcetree.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/9697c7c3d85f491aa190e07d6ee63cf8/git.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/07d2c83cc7ae42bbab53ce125fc0580b/tampermonkey.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/420cd87f3202462e82c067a2a2d3e695/virtualbox.png",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/e75bc64f20234a6b9a8163602ebdbabf/vscode.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/f7c1adaa32104876a4d4e57442b70cdf/wordpress.svg",
  "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/ecd30ba28f0d4646ab84e8ed07870ced/web.svg",
];

function extractImageUrls(html) {
  const urls = new Set();
  const $ = cheerio.load(html || "", null, false);
  $("img").each((_, img) => {
    const src = $(img).attr("src");
    if (src) urls.add(src);
  });
  return urls;
}

function collectAllUrls() {
  const urls = new Set(TAG_ICON_URLS);
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith(".json") || file === "media-map.json") continue;
    const article = JSON.parse(readFileSync(path.join(dataDir, file), "utf-8"));
    for (const u of extractImageUrls(article.content)) urls.add(u);
    if (article.mainvisual?.url) urls.add(article.mainvisual.url);
  }
  return [...urls];
}

function loadMap() {
  try {
    return JSON.parse(readFileSync(mapPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveMap(map) {
  writeFileSync(mapPath, JSON.stringify(map, null, "\t") + "\n", "utf-8");
}

async function main() {
  const urls = collectAllUrls();
  const map = loadMap();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "emdash-migrate-"));

  let done = 0;
  for (const url of urls) {
    if (map[url]) {
      done += 1;
      continue;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.jpg");
      const tmpFile = path.join(tmpDir, filename);
      writeFileSync(tmpFile, buf);

      const out = execFileSync("node", [emdashCli, "media", "upload", tmpFile], {
        cwd: repoRoot,
        encoding: "utf-8",
      });
      const jsonStart = out.indexOf("{");
      const item = JSON.parse(out.slice(jsonStart));
      map[url] = {
        id: item.id,
        storageKey: item.storageKey,
        filename: item.filename,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
      };

      rmSync(tmpFile, { force: true });
    } catch (err) {
      console.error(`FAILED ${url}: ${err.message}`);
    }
    done += 1;
    if (done % 10 === 0) {
      saveMap(map);
      console.log(`progress: ${done}/${urls.length}`);
    }
  }

  saveMap(map);
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Done. ${Object.keys(map).length}/${urls.length} images mapped.`);
}

main();
