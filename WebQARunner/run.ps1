$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path '.venv\Scripts\python.exe')) {
    Write-Error @"
가상환경이 없습니다. 아래 순서로 설치하세요:
  1. python -m venv .venv
  2. .venv\Scripts\Activate.ps1
  3. pip install -r requirements.txt
  4. playwright install chromium
"@
    exit 1
}

& '.venv\Scripts\Activate.ps1'
python runner.py @args
