# 섯다.xlsm E2E 테스트 (원본이 아닌 복사본에서 실행)
# 검증: 인원 선택(2인/5인), 라운드 진행, 콜/하프/다이, 자금 보존, VBA 오류 부재
$ErrorActionPreference = 'Stop'
$src = Join-Path (Split-Path -Parent $PSScriptRoot) '섯다.xlsm'
$copy = Join-Path $env:TEMP ("seotda_e2e_{0}.xlsm" -f (Get-Random))
Copy-Item $src $copy -Force
$xl = New-Object -ComObject Excel.Application
try {
    $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 1
    $wb = $xl.Workbooks.Open($copy)
    $xl.Run('FastOn') | Out-Null

    function St { return [string]$xl.Run('StateString') }
    function Total($s) { $p = $s -split '\|'; return [long]$p[1] + [long]$p[2] + [long]$p[3] + [long]$p[4] }
    function Phase($s) { return ($s -split '\|')[0] }
    function AssertNoVbaError {
        $msg = [string]$wb.Worksheets.Item('Game').Shapes.Item('lbl_Msg').TextFrame2.TextRange.Text
        if ($msg -like '오류*') { throw "VBA 오류 발생: $msg" }
    }
    function PlayRound($label, $baseline, $firstAct) {
        if ((Phase (St)) -eq '1' -and $firstAct) { $xl.Run($firstAct) }
        $guard = 0
        while ((Phase (St)) -eq '1' -and $guard -lt 40) { $xl.Run('OnCall'); $guard++ }
        $s = St
        Write-Host ("{0:HH:mm:ss} {1} : state={2} total={3}" -f (Get-Date), $label, $s, (Total $s))
        if ((Total $s) -ne $baseline) { throw "자금 보존 실패($label): $s (기준 $baseline)" }
        if ((Phase $s) -eq '1') { throw "라운드 미종료($label)" }
        AssertNoVbaError
    }

    # ===== 시나리오 A: 2인 초급 =====
    $xl.Run('OnCount2'); $xl.Run('OnEasy')
    $base = Total (St)
    Write-Host "2인 게임 시작, 총자금 기준 $base"
    if ($base -ne 20000) { throw "2인 시작 총자금 오류: $base" }
    PlayRound 'A-R1(콜만)' $base $null
    $xl.Run('OnNextRound')
    PlayRound 'A-R2(하프)' $base 'OnHalf'
    $xl.Run('OnNextRound')
    PlayRound 'A-R3(다이)' $base 'OnDie'
    # R4: 하프로 레이즈를 만든 뒤 따당 반복 (불가하면 자동으로 하프→콜 전환됨)
    $xl.Run('OnNextRound')
    if ((Phase (St)) -eq '1') { $xl.Run('OnHalf') }
    $guard = 0
    while ((Phase (St)) -eq '1' -and $guard -lt 40) { $xl.Run('OnDdadang'); $guard++ }
    $s = St
    Write-Host ("{0:HH:mm:ss} A-R4(따당) : state={1} total={2}" -f (Get-Date), $s, (Total $s))
    if ((Total $s) -ne $base) { throw "자금 보존 실패(A-R4): $s" }
    if ((Phase $s) -eq '1') { throw '라운드 미종료(A-R4)' }
    AssertNoVbaError

    # ===== 시나리오 B: 5인 고급 =====
    $xl.Run('OnBackToTitle')
    $xl.Run('OnCount5'); $xl.Run('OnHard')
    $base = Total (St)
    Write-Host "5인 게임 시작, 총자금 기준 $base"
    PlayRound 'B-R1(다이 후 AI끼리 진행)' $base 'OnDie'
    $xl.Run('OnNextRound')
    PlayRound 'B-R2(하프)' $base 'OnHalf'
    for ($r = 3; $r -le 6; $r++) {
        $xl.Run('OnNextRound')
        PlayRound "B-R$r(콜)" $base $null
    }
    Write-Host 'E2E 통과'
    $wb.Close($false)
}
finally {
    try { $xl.Quit() } catch {}
    try { [Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null } catch {}
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
    Remove-Item $copy -Force -ErrorAction SilentlyContinue
}