# digist — 使用指南

> 信息摄入引擎：多平台爬取→结构化→送入 KnowLever 编译

## 核心信息

| 维度 | 值 |
|---|---|
| 健康端点 | 端口 3800（/health?fast=1） |
| 启动命令 | `npm start (推测)` |
| 安装命令 | `npm ci (推测)` |
| 技术栈 | Node.js, TypeScript, Playwright (爬虫) |

## 快速启动

```bash
cd ~/Polarisor/digist
npm ci (推测)
npm start (推测)
```

## 健康检查

```bash
curl -s http://127.0.0.1:3800/health?fast=1
```

## 依赖服务

- Playwright (浏览器自动化)
- KnowLever (下游消费)
