
function Show-Version($label, $command, $cmdArgs) {
    $cmd = Get-Command $command -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { Write-Host ("{0,-12} NOT FOUND" -f $label) -ForegroundColor Yellow; return }
    try { $v = & $command @cmdArgs 2>&1 | Select-Object -First 1 } catch { $v = "error: $_" }
    Write-Host ("{0,-12} {1}" -f $label, $v)
}

Write-Host "Environment" -ForegroundColor Cyan
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("{0,-12} {1} (build {2})" -f "Windows", $os.Caption, $os.BuildNumber)
Show-Version "Node" "node" @("--version")
Show-Version "npm" "npm" @("--version")
Show-Version "pnpm" "pnpm" @("--version")
Show-Version "Corepack" "corepack" @("--version")
Show-Version "Git" "git" @("--version")
Show-Version "Docker" "docker" @("--version")
Show-Version "GitHub CLI" "gh" @("--version")

$drive = Get-PSDrive -Name V -ErrorAction SilentlyContinue
if ($drive) { Write-Host ("{0,-12} {1:N1} GB free on V:" -f "Disk", ($drive.Free / 1GB)) }

Write-Host "`nGit configuration" -ForegroundColor Cyan
foreach ($key in "user.name", "user.email", "core.autocrlf", "init.defaultBranch", "commit.gpgsign") {
    $value = git config --global --get $key 2>$null
    Write-Host ("{0,-20} {1}" -f $key, ($(if ($value) { $value } else { "(unset)" })))
}
if (Test-Path "$HOME\.ssh") {
    Write-Host ("{0,-20} {1}" -f "SSH keys", ((Get-ChildItem "$HOME\.ssh" -Filter *.pub | ForEach-Object Name) -join ", "))
}

Write-Host "`nRequired: Node 24 LTS (>=22.12 accepted), pnpm via Corepack (version pinned in package.json)." -ForegroundColor Cyan
