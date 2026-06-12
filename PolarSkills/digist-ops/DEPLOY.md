# digist — 部署指南

> 信息摄入引擎：多平台爬取→结构化→送入 KnowLever 编译

## 环境要求

- 技术栈：Node.js, TypeScript, Playwright (爬虫)
- 安装：`npm ci (推测)`

## 安装步骤

```bash
cd ~/Polarisor/digist
npm ci (推测)
```

## 启动方式

```bash
cd ~/Polarisor/digist
npm start (推测)
```

## 端口分配

| 端口 | 用途 |
|---|---|
| 3800 | 主服务 |

## 健康检查确认

```bash
curl -s http://127.0.0.1:3800/health?fast=1
```

## 回滚方式

```bash
cd ~/Polarisor/digist
git log --oneline -5
git checkout <previous-commit>
npm ci (推测)
npm start (推测)
```
