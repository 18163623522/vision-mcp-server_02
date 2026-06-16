# Vision MCP Server

截图 + 视觉模型分析 MCP 服务器，支持 Claude Code 等 MCP 客户端。

## 功能

| 工具 | 说明 |
|---|---|
| `describe_screen` | 截图并用视觉模型分析（支持全屏/主屏/指定窗口） |
| `take_screenshot` | 纯截图保存，不分析 |
| `list_windows` | 列出当前所有可见窗口标题 |
| `describe_image` | 分析一张已有的图片文件 |

## 安装

### 步骤一：Claude Code 插件安装

```bash
claude /plugin install github.com/你的用户名/vision-mcp-server
```

### 步骤二：手动配置

在 `~/.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "vision": {
      "command": "node",
      "args": ["路径/server.mjs"],
      "env": {
        "DASHSCOPE_API_KEY": "你的阿里云百炼 API Key"
      }
    }
  }
}
```

## 前置要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **阿里云百炼 API Key**：去 [bailian.console.aliyun.com](https://bailian.console.aliyun.com) → API Key 创建
- **Windows**：支持（PowerShell + .NET）
- **可选**：[Ollama](https://ollama.com) + `minicpm-v:8b`（本地模型备用）

## 配置说明

| 环境变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DASHSCOPE_API_KEY` | ✅ | - | 阿里云百炼 API Key |
| `VISION_CLOUD_MODEL` | ❌ | `qwen-vl-plus` | 云端模型名 |
| `VISION_LOCAL_MODEL` | ❌ | `minicpm-v:8b` | 本地备用模型 |
| `VISION_SCREENSHOT_DIR` | ❌ | `~/Pictures/Screenshots` | 截图保存目录 |

## 用法示例

```
"帮我看看浏览器当前页面"
"截一张全屏截图"
"分析这张图片：C:\photo.jpg"
"现在有哪些窗口开着"
```
