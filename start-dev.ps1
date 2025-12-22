# 清理所有 Node 进程
Write-Host "正在清理残留的 Node 进程..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 等待端口释放
Write-Host "等待端口释放..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# 检查端口是否已释放
$portInUse = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "警告: 端口 3000 可能仍被占用，但继续启动..." -ForegroundColor Yellow
}

# 启动开发服务器（在新窗口）
$scriptPath = $PSScriptRoot
if (-not $scriptPath) {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptPath'; Write-Host '正在启动开发服务器...' -ForegroundColor Green; npm run dev"
Write-Host "开发服务器正在新窗口中启动..." -ForegroundColor Green
Write-Host "访问: http://localhost:3000" -ForegroundColor Cyan

