# 把《熊二的世界》推送到 GitHub。由 推送到GitHub.bat 双击调用。
# 注意:本文件必须以「UTF-8 带 BOM」保存,否则 Windows PowerShell 5.1 会把中文读成乱码。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Repo = 'https://github.com/lxiaonan/game.git'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host '============================================================'
Write-Host "  把《熊二的世界》推送到 $Repo"
Write-Host '============================================================'
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host '[错误] 没有找到 git。请先安装 Git for Windows: https://git-scm.com/download/win'
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Write-Host '第一次运行，正在初始化仓库...'
    git init -b main | Out-Null
}

git remote remove origin 2>$null | Out-Null
git remote add origin $Repo

Write-Host '正在收集改动...'
git add -A

git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -q -m '更新《熊二的世界》'
    Write-Host '已提交本次改动。'
} else {
    Write-Host '没有新改动，直接推送。'
}

Write-Host ''
Write-Host '正在推送。如果弹出 GitHub 登录窗口，请登录 lxiaonan 账号并授权。'
Write-Host '（只有第一次需要，之后会记住。）'
Write-Host ''

git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '[推送失败] 常见原因：'
    Write-Host '  1. 登录窗口被关掉了 —— 重新运行一次再登录'
    Write-Host '  2. 登录的账号不是 lxiaonan —— 请用仓库所有者的账号'
    Write-Host '  3. 密码填的是账号密码 —— GitHub 现在只认 Personal Access Token，'
    Write-Host '     在 https://github.com/settings/tokens 生成一个勾选 repo 的 token，当密码填'
    exit 1
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  推送成功！'
Write-Host '============================================================'
Write-Host ''
Write-Host '最后一步（只需做一次）：'
Write-Host '  1. 打开 https://github.com/lxiaonan/game/settings/pages'
Write-Host '  2. Source 选 "Deploy from a branch"'
Write-Host '  3. Branch 选 main，目录选 /(root)，点 Save'
Write-Host '  4. 等 1 分钟左右，访问 https://lxiaonan.github.io/game/'
Write-Host ''
exit 0
