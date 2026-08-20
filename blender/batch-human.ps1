# r99-human full roster HD re-render (2026-08-20).
# Keep-awake sidecar is MANDATORY: the machine slept through two prior
# detached renders (HANDOFF g4-hd-sprites). Renders idle/walk/attack/work
# only -- die is never shipped (corpses use CORPSE_SPR).
$ErrorActionPreference='Continue'
$blender='C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$forge='C:\Users\deove\.claude\tiny-conquerors\blender\tc_forge.py'
$out='C:\Users\deove\.claude\tiny-conquerors\blender\outHuman2'
$log='C:\Users\deove\.claude\tiny-conquerors\blender\human-render.log'
$ka=@'
Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
while($true){[W.P]::SetThreadExecutionState(0x80000001)|Out-Null;Start-Sleep 50}
'@
$kaPath="$env:TEMP\tq-keepawake.ps1"
Set-Content -Path $kaPath -Value $ka -Encoding ascii
$kaProc=Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$kaPath -PassThru -WindowStyle Hidden
try{
  & $blender -b --factory-startup --python $forge -- --mode sheets --units all --anims idle,walk,attack,work --cell 256 --ppm 72 --out $out *> $log
}finally{
  Stop-Process -Id $kaProc.Id -Force -ErrorAction SilentlyContinue
}
'BATCH DONE'
