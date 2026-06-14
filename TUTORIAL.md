# Vision MCP Server 使用教程

## 这个东西能干什么

装上之后，Claude Code 就能：

| 功能 | 怎么用 |
|---|---|
| 📸 **截图 + 分析** | 直接说"看看我浏览器在干嘛"，自动截图并用 AI 分析 |
| 🖼️ **分析已有图片** | 指定图片路径，让视觉模型分析内容 |
| 📋 **列出所有窗口** | "现在有哪些窗口开着" |

---

## 第一步：安装前的准备

### 1. 安装 Node.js

去 [nodejs.org](https://nodejs.org) 下载 LTS 版本，安装后验证：

```bash
node --version   # 应该 ≥ v18
npm --version    # 应该 ≥ v9
```

### 2. 获取阿里云百炼 API Key

1. 打开 [bailian.console.aliyun.com](https://bailian.console.aliyun.com)
2. 左侧菜单点 **API Key**
3. 创建一个新 Key，复制备用

> **费用**：新用户有 100 万 Token 免费额度，够用很久。

---

## 第二步：安装插件

在终端运行：

```bash
claude /plugin install github.com/leydidishc280-dotcom/vision-mcp-server
```

或者手动安装：

1. 克隆仓库到本地：
```bash
git clone https://github.com/leydidishc280-dotcom/vision-mcp-server.git
cd vision-mcp-server
npm install
```

2. 在 `~/.mcp.json`（用户目录下）添加：

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["D:\\AI_Workspace\\vision-mcp-server\\server.mjs"],
      "env": {
        "DASHSCOPE_API_KEY": "你的阿里云百炼 API Key"
      }
    }
  }
}
```

> **注意**：`args` 里的路径要改成你实际存放 `server.mjs` 的路径。

---

## 第三步：启用插件

在 Claude Code 的 `~/.claude/settings.local.json` 中添加：

```json
{
  "permissions": {
    "allow": [
      "mcp__vision__describe_screen",
      "mcp__vision__describe_image",
      "mcp__vision__list_windows"
    ]
  },
  "enabledMcpjsonServers": ["vision"]
}
```

重启 Claude Code。

---

## 第四步：开始使用

### 基础用法

| 你说的话 | 它会做什么 |
|---|---|
| "看看我浏览器在干嘛" | 截浏览器窗口 → AI 分析内容 |
| "截一下我现在的全屏" | 截整个桌面 → AI 分析 |
| "分析这张图：C:\photo.jpg" | 读取已有图片 → AI 分析 |
| "有哪些窗口开着" | 列出所有可见窗口 |

### 高级用法

你可以给它具体的分析指令：

> "截浏览器窗口，重点看有没有创建 API 的按钮"

> "看看我桌面右下角的时间"

> "这张图片里的错误信息是什么"

---

## 可选：配置本地模型（免费替代方案）

如果你有 NVIDIA 显卡（≥8GB 显存），可以安装本地模型，断网也能用：

### 1. 安装 Ollama

去 [ollama.com](https://ollama.com) 下载安装

### 2. 下载视觉模型

```bash
ollama pull minicpm-v:8b
```

### 3. 让插件使用本地模型

在 `.mcp.json` 的 `env` 里加一行：

```json
"VISION_CLOUD_MODEL": ""
```

这样云端调用会失败，自动切到本地模型。

> ⚠️ 本地 8B 模型准确度不如云端，适合简单场景。

---

## 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | ✅ | - | 阿里云百炼 API Key |
| `VISION_CLOUD_MODEL` | ❌ | `qwen-vl-plus` | 云端模型名 |
| `VISION_LOCAL_MODEL` | ❌ | `minicpm-v:8b` | 本地备用模型 |
| `VISION_SCREENSHOT_DIR` | ❌ | `~/Pictures/Screenshots` | 截图保存目录 |

---

## 常见问题

### Q: 提示"找不到窗口"

确认你用的关键词和窗口标题匹配。先运行 `list_windows` 看确切标题。

### Q: 截图失败 / Defender 报毒

这是 Windows Defender 的 AMSI 误判。本插件使用 GDI BitBlt 底层 API 已绕过此问题。

### Q: 分析很慢

云端模型通常 5-15 秒，取决于 DashScope 服务端负载。首次使用可能更慢。

### Q: 显示乱码

如果窗口标题有乱码，通常是系统编码问题，不影响截图功能。

---

## 更新插件

```bash
claude /plugin update vision-mcp-server
```

或手动 `git pull` 后重启。
