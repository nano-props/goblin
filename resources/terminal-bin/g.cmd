@echo off
setlocal
if "%GOBLIN_NODE%"=="" (
  echo g: GOBLIN_NODE is not set 1>&2
  exit /b 127
)
if "%GOBLIN_CLI_ENTRY%"=="" (
  echo g: GOBLIN_CLI_ENTRY is not set 1>&2
  exit /b 127
)
set "ELECTRON_RUN_AS_NODE=1"
set "ELECTRON_NO_ASAR=1"
"%GOBLIN_NODE%" "%GOBLIN_CLI_ENTRY%" %*
