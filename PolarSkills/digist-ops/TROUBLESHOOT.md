# digist — 故障排查

> 信息摄入引擎：多平台爬取→结构化→送入 KnowLever 编译

## 健康检查

```bash
# 进程存活
pgrep -f "digist" || echo "NOT RUNNING"

# HTTP 端点
curl -s http://127.0.0.1:3800/health?fast=1
```

## 关键端口

| 端口 | 说明 |
|---|---|
| 3800 | digist 主服务 |

## 常见故障

### 1. 爬虫被封

**修复**：`检查 IP / User-Agent / 频率限制`

### 2. Playwright 浏览器崩溃

**修复**：`npx playwright install chromium 重装`

### 3. 输出格式异常

**修复**：`检查 scrapers/ 目录对应平台解析器`

## 依赖服务

- Playwright (浏览器自动化)
- KnowLever (下游消费)

## 紧急恢复

```bash
cd ~/Polarisor/digist
npm start (推测)
curl -s http://127.0.0.1:3800/health?fast=1 && echo 'OK' || echo 'BROKEN'
```
