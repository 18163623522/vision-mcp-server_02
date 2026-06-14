import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

// ─── Config ───────────────────────────────────────────────────
const SCREENSHOT_DIR = "C:\\Users\\Administrator\\Pictures\\Screenshots";
const OLLAMA_API = "http://localhost:11434/api/generate";
const LOCAL_VISION_MODEL = "minicpm-v:8b";
const DASHSCOPE_API = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || "";
const CLOUD_VISION_MODEL = "qwen-vl-plus";
const __dirname = dirname(fileURLToPath(import.meta.url));

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ─── DPI header ───────────────────────────────────────────────
const DPI_PREAMBLE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DPI {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[DPI]::SetProcessDPIAware() | Out-Null
`;

// ─── PowerShell helpers ────────────────────────────────────────

function runPS(script, timeoutMs = 60000) {
  // Write script to temp file to avoid execSync + -EncodedCommand base64 corruption
  // (Node's execSync → cmd /s /c → CreateProcess chain can mangle base64 on Windows)
  const tmpFile = join(tmpdir(), "vms-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".ps1");
  writeFileSync(tmpFile, "﻿" + script, "utf-8");
  try {
    const result = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "' + tmpFile + '"',
      { encoding: "utf-8", timeout: timeoutMs, windowsHide: true }
    ).trim();
    return result;
  } finally {
    try { unlinkSync(tmpFile); } catch (_) { /* best effort cleanup */ }
  }
}

function tsFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function escPS(s) {
  return s.replace(/'/g, "''");
}

// ─── Screenshot logic ─────────────────────────────────────────

function listWindows() {
  const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinList {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static List<IntPtr> handles=new List<IntPtr>();
  public static List<string> titles=new List<string>();
  public static bool Callback(IntPtr hWnd, IntPtr lParam) {
    if(IsWindowVisible(hWnd)){
      int len=GetWindowTextLength(hWnd);
      if(len>0){
        StringBuilder sb=new StringBuilder(len+1);
        GetWindowText(hWnd,sb,sb.Capacity);
        string t=sb.ToString();
        if(!string.IsNullOrWhiteSpace(t) && !t.Contains("Ollama") && t!="Windows Shell Experience Host"){
          handles.Add(hWnd); titles.Add(t);
        }
      }
    }
    return true;
  }
  public static void Enumerate(){ handles.Clear(); titles.Clear(); EnumWindows(Callback,IntPtr.Zero); }
}
"@
[WinList]::Enumerate()
for($i=0;$i -lt [WinList]::titles.Count;$i++){ Write-Output ("$i|"+[WinList]::titles[$i]) }
`.trim();
  const out = runPS(ps, 10000);
  return out.split("\n").filter(l => l.includes("|")).map(line => {
    const idx = line.indexOf("|");
    return { index: parseInt(line.slice(0, idx)), title: line.slice(idx + 1) };
  });
}

/** Save bitmap to file — format-aware */
function saveCmdFor(fp, format) {
  if (format === 'jpeg') {
    return "$eps = New-Object System.Drawing.Imaging.EncoderParameters(1); $eps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 80L); $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.MimeType -eq 'image/jpeg'}; $bmp.Save('" + fp + "', $jpegCodec, $eps);";
  }
  return "$bmp.Save('" + fp + "', [System.Drawing.Imaging.ImageFormat]::Png);";
}

function capture(mode, windowTitle, filename, format, maxWidth) {
  format = format || 'png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const fname = (filename || 'screenshot-' + tsFilename()).replace(/\.(png|jpg)$/i, '') + '.' + ext;
  const fp = join(SCREENSHOT_DIR, fname);
  const fpEsc = fp.replace(/\\/g, "\\\\");
  const saveCmd = saveCmdFor(fpEsc, format);
  const scaleBlock = maxWidth ? `
$scale = [Math]::Min(1.0, ${maxWidth} / $w)
if($scale -lt 1.0){
  $nw = ${maxWidth}; $nh = [int]($h * $scale)
  $bmp2 = New-Object System.Drawing.Bitmap($nw, $nh)
  $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $nw, $nh)
  $g.Dispose(); $bmp.Dispose()
  $bmp = $bmp2; $g = $g2; $w = $nw; $h = $nh
}
` : "";

  let ps;
  if (mode === "window" && windowTitle) {
    // PrintWindow: capture in background, no SetForegroundWindow needed
    ps = DPI_PREAMBLE + `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint nFlags);
  public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);
  public struct RECT { public int Left,Top,Right,Bottom; }
  public static string search;
  public static IntPtr found = IntPtr.Zero;
  public static bool Callback(IntPtr hWnd, IntPtr lParam) {
    if(IsWindowVisible(hWnd)){
      StringBuilder sb=new StringBuilder(256);
      GetWindowText(hWnd,sb,256);
      string t=sb.ToString();
      if(t.ToLower().Contains(search.ToLower())){ found=hWnd; return false; }
    }
    return true;
  }
  public static IntPtr Find(string t){ search=t; found=IntPtr.Zero; EnumWindows(Callback,IntPtr.Zero); return found; }
  public static RECT GetBounds(IntPtr h){ RECT r; GetWindowRect(h,out r); return r; }
}
"@
$hwnd = [WinCap]::Find('${escPS(windowTitle)}')
if($hwnd -eq [IntPtr]::Zero){ throw "Window not found: ${escPS(windowTitle)}" }
$r = [WinCap]::GetBounds($hwnd)
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if($w -le 0 -or $h -le 0){ throw "Invalid window size: $w x $h" }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PrintWindow with PW_RENDERFULLCONTENT=2: captures hardware-accelerated content (browsers, etc.)
[WinCap]::PrintWindow($hwnd, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
` + scaleBlock + saveCmd + `
$g.Dispose(); $bmp.Dispose()
Write-Output '${fpEsc}'
`.trim();

  } else if (mode === "full") {
    // GDI BitBlt instead of CopyFromScreen — avoids Defender AMSI
    ps = DPI_PREAMBLE + `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GdiCap {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateDC(string driver, string device, string output, IntPtr data);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int x, int y, int w, int h, IntPtr hdcSrc, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
}
"@
$x = [GdiCap]::GetSystemMetrics(76); $y = [GdiCap]::GetSystemMetrics(77)
$w = [GdiCap]::GetSystemMetrics(78); $h = [GdiCap]::GetSystemMetrics(79)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdcDest = $g.GetHdc()
$hdcSrc = [GdiCap]::CreateDC("DISPLAY", $null, $null, [IntPtr]::Zero)
[GdiCap]::BitBlt($hdcDest, 0, 0, $w, $h, $hdcSrc, $x, $y, 0x00CC0020) | Out-Null
$g.ReleaseHdc($hdcDest)
[GdiCap]::DeleteDC($hdcSrc) | Out-Null
` + scaleBlock + saveCmd + `
$g.Dispose(); $bmp.Dispose()
Write-Output '${fpEsc}'
`.trim();

  } else {
    // primary — same GDI BitBlt approach
    ps = DPI_PREAMBLE + `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GdiCap {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateDC(string driver, string device, string output, IntPtr data);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int x, int y, int w, int h, IntPtr hdcSrc, int sx, int sy, uint rop);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
}
"@
$x = 0; $y = 0
$w = [GdiCap]::GetSystemMetrics(0); $h = [GdiCap]::GetSystemMetrics(1)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdcDest = $g.GetHdc()
$hdcSrc = [GdiCap]::CreateDC("DISPLAY", $null, $null, [IntPtr]::Zero)
[GdiCap]::BitBlt($hdcDest, 0, 0, $w, $h, $hdcSrc, $x, $y, 0x00CC0020) | Out-Null
$g.ReleaseHdc($hdcDest)
[GdiCap]::DeleteDC($hdcSrc) | Out-Null
` + scaleBlock + saveCmd + `
$g.Dispose(); $bmp.Dispose()
Write-Output '${fpEsc}'
`.trim();
  }

  const out = runPS(ps, 15000);
  const savedPath = out.split("\n").pop().trim();
  if (savedPath && existsSync(savedPath.replace(/\\\\/g, "\\"))) {
    return savedPath.replace(/\\\\/g, "\\");
  }
  const fallback = join(SCREENSHOT_DIR, fname);
  if (existsSync(fallback)) return fallback;
  throw new Error("截图失败: PowerShell 未返回有效路径.\n输出: " + out);
}

// ─── Vision API ───────────────────────────────────────────────

async function describeImage(imagePath, prompt) {
  if (!existsSync(imagePath)) {
    throw new Error("图片不存在: " + imagePath);
  }

  const timings = {};
  const t0 = performance.now();

  // ① Read file + base64 encode
  const t1 = performance.now();
  const ext = imagePath.split(".").pop().toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  const imageBase64 = readFileSync(imagePath).toString("base64");
  const dataUrl = "data:image/" + mime + ";base64," + imageBase64;
  const fileSizeKB = (readFileSync(imagePath).length / 1024).toFixed(1);
  timings.readAndEncode = Math.round(performance.now() - t1);

  // ② Cloud API — qwen-vl-max via DashScope
  let cloudTTFB = 0, cloudDecode = 0, cloudTime = 0;
  try {
    const body = JSON.stringify({
      model: CLOUD_VISION_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const ctrl = new AbortController();
    const t = setTimeout(function() { ctrl.abort(); }, 120000);
    const tCloudStart = performance.now();
    try {
      const resp = await fetch(DASHSCOPE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + DASHSCOPE_KEY,
        },
        body,
        signal: ctrl.signal,
      });
      cloudTTFB = Math.round(performance.now() - tCloudStart);
      if (resp.ok) {
        const tDecode = performance.now();
        const data = await resp.json();
        cloudDecode = Math.round(performance.now() - tDecode);
        cloudTime = Math.round(performance.now() - tCloudStart);
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          timings.cloudTTFB = cloudTTFB;
          timings.cloudDecode = cloudDecode;
          timings.cloudTotal = cloudTime;
          timings.total = Math.round(performance.now() - t0);
          return { text: content, timings, fileSizeKB, model: CLOUD_VISION_MODEL };
        }
      }
      console.error("[vision] Cloud API failed, falling back to local...");
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error("[vision] Cloud API error:", e.message);
  }

  // ③ Local fallback — Ollama
  const tLocalStart = performance.now();
  const localBody = JSON.stringify({
    model: LOCAL_VISION_MODEL,
    prompt,
    images: [imageBase64],
    stream: false,
  });
  const ctrl = new AbortController();
  const t = setTimeout(function() { ctrl.abort(); }, 180000);
  try {
    const resp = await fetch(OLLAMA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: localBody,
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error("Ollama API " + resp.status);
    const data = await resp.json();
    const localTime = Math.round(performance.now() - tLocalStart);
    timings.localTotal = localTime;
    timings.total = Math.round(performance.now() - t0);
    return { text: data.response || JSON.stringify(data), timings, fileSizeKB, model: LOCAL_VISION_MODEL };
  } finally {
    clearTimeout(t);
  }
}

// ─── MCP Server ───────────────────────────────────────────────

const server = new Server(
  { name: "vision-mcp-server", version: "1.3.0" },
  { capabilities: { tools: {} } }
);

function toolDef(name, desc, schema) {
  return { name, description: desc, inputSchema: schema };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    toolDef("describe_screen",
      "截屏并用视觉模型分析描述。可以截整个桌面、主屏幕、或指定窗口。截窗口时用 PrintWindow 后台截取，不动任何窗口。",
      { type: "object", properties: {
        mode: { type: "string", enum: ["full", "primary", "window"], description: "截屏范围: 'full'=所有显示器, 'primary'=主显示器, 'window'=指定窗口(后台截取)。默认 'full'。" },
        window: { type: "string", description: "mode='window' 时的窗口标题关键字。" },
        prompt: { type: "string", description: "可选：自定义分析指令。" },
      }}
    ),
    toolDef("take_screenshot",
      "只截屏保存，不分析。",
      { type: "object", properties: {
        mode: { type: "string", enum: ["full", "primary", "window"], description: "截屏范围，默认 'full'" },
        window: { type: "string", description: "窗口标题关键字" },
        filename: { type: "string", description: "可选：保存文件名" },
      }}
    ),
    toolDef("list_windows",
      "列出当前所有可见窗口的标题。",
      { type: "object", properties: {} }
    ),
    toolDef("describe_image",
      "分析一张已有的图片。",
      { type: "object", properties: {
        path: { type: "string", description: "图片文件完整路径" },
        prompt: { type: "string", description: "可选：自定义分析指令" },
      }, required: ["path"] }
    ),
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {

      case "list_windows": {
        const wins = listWindows();
        if (wins.length === 0) {
          return { content: [{ type: "text", text: "没有找到可见窗口。" }] };
        }
        const text = wins.map(function(w) { return "[" + w.index + "] " + w.title; }).join("\n");
        return { content: [{ type: "text", text: "当前可见窗口 (" + wins.length + "个):\n" + text }] };
      }

      case "take_screenshot": {
        const mode = args?.mode || "full";
        const windowTitle = args?.window || null;
        if (mode === "window" && !windowTitle) {
          throw new Error("mode='window' 时必须提供 window 参数");
        }
        const fp = capture(mode, windowTitle, args?.filename || null, 'png');
        const kb = (readFileSync(fp).length / 1024).toFixed(1);
        return { content: [{ type: "text", text: "✅ 截图已保存\n路径: " + fp + "\n大小: " + kb + " KB" }] };
      }

      case "describe_screen": {
        const mode = args?.mode || "full";
        const windowTitle = args?.window || null;
        if (mode === "window" && !windowTitle) {
          throw new Error("mode='window' 时必须提供 window 参数");
        }
        const tCapStart = performance.now();
        const fp = capture(mode, windowTitle, null, 'jpeg', 1920);
        const capTime = Math.round(performance.now() - tCapStart);
        const kb = (readFileSync(fp).length / 1024).toFixed(1);
        const scopeText = mode === "window" ? "窗口 \"" + windowTitle + "\"" : mode === "full" ? "全部显示器" : "主屏幕";
        const defaultPrompt = "请详细描述这张截图中的所有内容。截图范围：" + scopeText + "。包括：打开的窗口、正在运行的程序、可见的文字、图标、任务栏状态、任何错误提示或异常。用中文回复。";
        const prompt = args?.prompt || defaultPrompt;
        const result = await describeImage(fp, prompt);
        let timingBlock = "⏱️ 耗时分析:\n  ① 截屏(PowerShell): " + capTime + "ms";
        if (result.timings.readAndEncode) timingBlock += "\n  ② 读文件+base64编码 (" + result.fileSizeKB + "KB): " + result.timings.readAndEncode + "ms";
        if (result.timings.cloudTTFB) timingBlock += "\n  ③ 上传+等待云端首字节(TTFB): " + result.timings.cloudTTFB + "ms";
        if (result.timings.cloudDecode) timingBlock += "\n  ④ 云端JSON解析: " + result.timings.cloudDecode + "ms";
        if (result.timings.cloudTotal) timingBlock += "\n  ⑤ 云端总耗时: " + result.timings.cloudTotal + "ms";
        if (result.timings.localTotal) timingBlock += "\n  ③ 本地Ollama总耗时: " + result.timings.localTotal + "ms";
        timingBlock += "\n  📌 总耗时: " + result.timings.total + "ms | 模型: " + result.model;
        return { content: [{ type: "text", text: "📸 " + scopeText + " | " + fp + " (" + kb + " KB)\n\n" + timingBlock + "\n\n📝 分析:\n" + result.text }] };
      }

      case "describe_image": {
        const result = await describeImage(
          args.path,
          args.prompt || "请详细描述这张图片中的所有内容，用中文回复。"
        );
        let timingBlock = "⏱️ 耗时: ";
        if (result.timings.readAndEncode) timingBlock += "编码" + result.timings.readAndEncode + "ms → ";
        if (result.timings.cloudTTFB) timingBlock += "TTFB " + result.timings.cloudTTFB + "ms → 云端总计" + result.timings.cloudTotal + "ms";
        timingBlock += " → 总" + result.timings.total + "ms (" + result.model + ")";
        return { content: [{ type: "text", text: timingBlock + "\n\n📝 图片分析:\n" + result.text }] };
      }

      default:
        throw new Error("未知工具: " + name);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: "❌ " + err.message }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vision-mcp-server] v1.3 已启动，云端:", CLOUD_VISION_MODEL, "| 本地备用:", LOCAL_VISION_MODEL);
}

main().catch(function(err) {
  console.error("[vision-mcp-server] 启动失败:", err);
  process.exit(1);
});
