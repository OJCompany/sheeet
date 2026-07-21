# 엑셀 섯다 게임 빌드 스크립트
# - Game/Assets/Data/Save 시트 + 도형 UI 생성
# - VBA 모듈 주입 (build\vba\*.bas)
# - SelfTest 실행 후 섯다.xlsm 저장, 재오픈 검증
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # 저장소 루트 (이 스크립트는 build\ 안에 있음)
$out = Join-Path $root '섯다.xlsm'
$vbaDir = Join-Path $PSScriptRoot 'vba'

# 0) VBA 프로젝트 개체 모델 접근 허용 (빌드에 필요)
$secPath = 'HKCU:\Software\Microsoft\Office\16.0\Excel\Security'
if (-not (Test-Path $secPath)) { New-Item -Path $secPath -Force | Out-Null }
Set-ItemProperty -Path $secPath -Name AccessVBOM -Value 1 -Type DWord

function RGBv([int]$r, [int]$g, [int]$b) { return ($r + $g * 256 + $b * 65536) }

function Add-Shp {
    param($ws, [string]$name, [int]$type,
          [double]$x, [double]$y, [double]$w, [double]$h,
          $fill, $line, [string]$text, [double]$fsize, [bool]$bold, $fcolor,
          [int]$align, [string]$onaction, [bool]$visible, [double]$corner)
    $sh = $ws.Shapes.AddShape($type, $x, $y, $w, $h)
    $sh.Name = $name
    if ($null -ne $fill) { $sh.Fill.ForeColor.RGB = [int]$fill } else { $sh.Fill.Visible = 0 }
    if ($null -ne $line) { $sh.Line.ForeColor.RGB = [int]$line; $sh.Line.Weight = 1.25 } else { $sh.Line.Visible = 0 }
    $sh.Shadow.Visible = 0
    if ($corner -ge 0 -and $sh.Adjustments.Count -ge 1) { $sh.Adjustments.Item(1) = $corner }
    if ($text -ne '') {
        $tr = $sh.TextFrame2.TextRange
        $tr.Text = $text
        $f = $tr.Font
        $f.Name = 'Jua'
        $f.NameFarEast = 'Jua'
        $f.Size = $fsize
        $f.Bold = $(if ($bold) { -1 } else { 0 })
        $f.Fill.ForeColor.RGB = [int]$fcolor
        $tr.ParagraphFormat.Alignment = $align
    }
    $sh.TextFrame2.VerticalAnchor = 3
    $sh.TextFrame2.WordWrap = -1
    if ($onaction -ne '') { $sh.OnAction = $onaction }
    if (-not $visible) { $sh.Visible = 0 }
    return $sh
}

$xl = $null
try {
    if (Test-Path $out) { Remove-Item $out -Force }

    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false
    $xl.DisplayAlerts = $false
    $xl.ScreenUpdating = $false

    $wb = $xl.Workbooks.Add()
    while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
    $wsGame = $wb.Worksheets.Item(1); $wsGame.Name = 'Game'
    $wsAssets = $wb.Worksheets.Add([Type]::Missing, $wsGame);   $wsAssets.Name = 'Assets'
    $wsData   = $wb.Worksheets.Add([Type]::Missing, $wsAssets); $wsData.Name = 'Data'
    $wsSave   = $wb.Worksheets.Add([Type]::Missing, $wsData);   $wsSave.Name = 'Save'

    # ===== 색상 =====
    $GREEN     = RGBv 21 86 53
    $DARKGREEN = RGBv 13 60 38
    $GOLD      = RGBv 240 200 90
    $WHITE     = RGBv 245 245 245
    $GRAYTXT   = RGBv 200 205 210
    $CARDBACK  = RGBv 150 34 34
    $CARDBACKL = RGBv 90 16 16
    $BACKTXT   = RGBv 230 195 120

    # ===== Game 시트 =====
    $wsGame.Cells.Interior.Color = $DARKGREEN

    Add-Shp $wsGame 'bg_Table'   1   0   0 990 590 $GREEN (RGBv 10 50 32) '' 10 $false $WHITE 2 '' $true -1 | Out-Null
    # AI 좌석 4세트 (위치는 modUI.LayoutSeats가 인원수에 맞춰 조정)
    for ($s = 1; $s -le 4; $s++) {
        Add-Shp $wsGame "ai${s}_avatar" 9 (60 + $s * 10) 12 46 46 (RGBv 60 160 140) $GOLD '?' 16 $true $WHITE 2 '' $false -1 | Out-Null
        Add-Shp $wsGame "ai${s}_name"  1 (110 + $s * 10) 14 118 22 $null $null "AI $s" 12 $true $WHITE 1 '' $false -1 | Out-Null
        Add-Shp $wsGame "ai${s}_money" 1 (110 + $s * 10) 38 118 20 $null $null '자금  10,000P' 10 $false $GRAYTXT 1 '' $false -1 | Out-Null
        Add-Shp $wsGame "ai${s}_c1"    5 (100 + $s * 10) 64  70 100 $CARDBACK $CARDBACKL "花`n鬪" 15 $true $BACKTXT 2 '' $false 0.12 | Out-Null
        Add-Shp $wsGame "ai${s}_c2"    5 (180 + $s * 10) 64  70 100 $CARDBACK $CARDBACKL "花`n鬪" 15 $true $BACKTXT 2 '' $false 0.12 | Out-Null
        Add-Shp $wsGame "ai${s}_hand"  1 (100 + $s * 10) 168 170 20 $null $null '족보' 11 $true $GOLD 2 '' $false -1 | Out-Null
    }
    Add-Shp $wsGame 'deck_Pile'  5  60 215  90 130 $CARDBACK $CARDBACKL "花`n鬪" 22 $true $BACKTXT 2 '' $true 0.12 | Out-Null
    Add-Shp $wsGame 'lbl_Pot'    1 390 228 215  34 $null $null '판돈  0P' 16 $true $GOLD 2 '' $true -1 | Out-Null
    Add-Shp $wsGame 'lbl_Msg'    5 200 270 590  48 (RGBv 8 42 27) $null '엑셀 섯다에 오신 것을 환영합니다' 13 $false $WHITE 2 '' $true 0.5 | Out-Null
    Add-Shp $wsGame 'card_P1'    5 400 330  90 130 $CARDBACK $CARDBACKL "花`n鬪" 22 $true $BACKTXT 2 '' $false 0.12 | Out-Null
    Add-Shp $wsGame 'card_P2'    5 505 330  90 130 $CARDBACK $CARDBACKL "花`n鬪" 22 $true $BACKTXT 2 '' $false 0.12 | Out-Null
    Add-Shp $wsGame 'lbl_PHand'  1 395 466 205  26 $null $null '족보' 13 $true $GOLD 2 '' $false -1 | Out-Null
    Add-Shp $wsGame 'player_avatar' 9 60 438 48 48 (RGBv 60 160 140) $GOLD '플' 16 $true $WHITE 2 '' $true -1 | Out-Null
    Add-Shp $wsGame 'lbl_PName'  1 116 438 150  22 $null $null '플레이어' 14 $true $WHITE 1 '' $true -1 | Out-Null
    Add-Shp $wsGame 'lbl_PMoney' 1 116 461 160  20 $null $null '자금  10,000P' 11 $false $GRAYTXT 1 '' $true -1 | Out-Null
    Add-Shp $wsGame 'lbl_Record' 1 116 483 160  20 $null $null '전적  0승 0패' 11 $false $GRAYTXT 1 '' $true -1 | Out-Null
    Add-Shp $wsGame 'btn_Call'    5 205 505 120  46 (RGBv 58 118 240) (RGBv 30 70 160) '콜' 15 $true $WHITE 2 'modMain.OnCall' $false 0.3 | Out-Null
    Add-Shp $wsGame 'btn_Half'    5 340 505 120  46 (RGBv 235 150 45) (RGBv 160 95 20) '하프' 15 $true $WHITE 2 'modMain.OnHalf' $false 0.3 | Out-Null
    Add-Shp $wsGame 'btn_Ddadang' 5 475 505 120  46 (RGBv 150 70 190) (RGBv 95 40 130) '따당' 15 $true $WHITE 2 'modMain.OnDdadang' $false 0.3 | Out-Null
    Add-Shp $wsGame 'btn_Die'     5 610 505 120  46 (RGBv 205 70 70) (RGBv 130 35 35) '다이' 15 $true $WHITE 2 'modMain.OnDie' $false 0.3 | Out-Null
    Add-Shp $wsGame 'btn_Next'    5 745 505 150  46 (RGBv 70 170 90) (RGBv 30 110 55) '다음 판' 14 $true $WHITE 2 'modMain.OnNextRound' $false 0.3 | Out-Null
    Add-Shp $wsGame 'btn_Title'   5 870  20 100  34 (RGBv 90 100 110) (RGBv 50 58 66) '타이틀' 11 $true $WHITE 2 'modMain.OnBackToTitle' $true 0.3 | Out-Null

    # 우측 족보 패널
    $jokboText = "족보 순위`n──────`n38광땡`n18·13광땡`n장땡 ~ 1땡`n알리 (1·2)`n독사 (1·4)`n구삥 (1·9)`n장삥 (1·10)`n장사 (4·10)`n세륙 (4·6)`n갑오 ~ 1끗`n망통`n──────`n땡잡이 3·7`n: 1~9땡 잡음`n암행어사 4·7열`n: 광땡 잡음`n구사 4·9`n: 알리↓ 재경기"
    $jp = Add-Shp $wsGame 'jokbo_panel' 5 858 64 122 420 (RGBv 8 42 27) (RGBv 60 130 90) $jokboText 9.5 $false (RGBv 215 222 218) 1 '' $true 0.08
    $jp.TextFrame2.VerticalAnchor = 1   # 위쪽 정렬
    $jp | Out-Null

    # 타이틀 오버레이 (맨 위 z-order) - 배경 이미지는 실행 시 modUI.RenderTitleBg가 채움
    # 로고(상단 중앙)와 하단 중앙 카드를 피해 중앙 빈 영역(y300~450)에 버튼 배치
    # 배경 이미지 톤에 맞춘 팔레트: 크림 / 진홍(카드 빨강) / 다크브라운(로고 테두리)
    $CREAM = RGBv 245 233 200
    $DEEPRED = RGBv 168 42 38
    $BROWN = RGBv 88 52 28
    Add-Shp $wsGame 'title_bg'   1   0   0 990 590 (RGBv 24 28 40) $null '' 10 $false $WHITE 2 '' $true -1 | Out-Null
    Add-Shp $wsGame 'btn_Cnt2'   5 290 300  95  42 $DEEPRED $BROWN '2인' 15 $false $CREAM 2 'modMain.OnCount2' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Cnt3'   5 395 300  95  42 $DEEPRED $BROWN '3인' 15 $false $CREAM 2 'modMain.OnCount3' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Cnt4'   5 500 300  95  42 $DEEPRED $BROWN '4인' 15 $false $CREAM 2 'modMain.OnCount4' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Cnt5'   5 605 300  95  42 $DEEPRED $BROWN '5인' 15 $false $CREAM 2 'modMain.OnCount5' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Easy'   5 258 356 150  46 (RGBv 58 122 74) $BROWN '초급으로 시작' 15 $false $CREAM 2 'modMain.OnEasy' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Normal' 5 420 356 150  46 (RGBv 196 130 42) $BROWN '중급으로 시작' 15 $false $CREAM 2 'modMain.OnNormal' $true 0.5 | Out-Null
    Add-Shp $wsGame 'btn_Hard'   5 582 356 150  46 $DEEPRED $BROWN '고급으로 시작' 15 $false $CREAM 2 'modMain.OnHard' $true 0.5 | Out-Null
    Add-Shp $wsGame 'title_stats' 1 295 416 400 28 $null $null '전적 0승 0패' 15 $false $CREAM 2 '' $true -1 | Out-Null

    # ===== Assets 시트 (화투패 원본 - 참고/교체용) =====
    $wsAssets.Cells.Item(1, 1).Value2 = '화투패 원본(참고용). 실제 표시는 modUI.RenderCard가 그립니다. 이미지로 교체하려면 같은 이름으로 배치하세요.'
    $monthNames = @('', '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍')
    $gwangIds = @(11, 31, 81)
    $idx = 0
    for ($m = 1; $m -le 10; $m++) {
        for ($k = 1; $k -le 2; $k++) {
            $id = $m * 10 + $k
            $col = $idx % 5
            $row = [math]::Floor($idx / 5)
            $x = 40 + $col * 110
            $y = 40 + $row * 150
            $isG = $gwangIds -contains $id
            $text = if ($isG) { "$m`n$($monthNames[$m])`n光" } else { "$m`n$($monthNames[$m])" }
            $fc = if ($isG) { RGBv 190 30 30 } else { RGBv 35 35 35 }
            Add-Shp $wsAssets "Card_$id" 5 $x $y 90 130 (RGBv 250 247 238) (RGBv 70 70 70) $text 20 $true $fc 2 '' $true 0.12 | Out-Null
            $idx++
        }
    }
    Add-Shp $wsAssets 'Card_Back' 5 40 640 90 130 $CARDBACK $CARDBACKL "花`n鬪" 22 $true $BACKTXT 2 '' $true 0.12 | Out-Null

    # ===== Data 시트 (AI 파라미터) =====
    $wsData.Cells.Item(1, 1).Value2 = 'AI 파라미터 (수정하면 게임에 반영됩니다)'
    $wsData.Cells.Item(2, 1).Value2 = '난이도'
    $wsData.Cells.Item(2, 2).Value2 = '공격성'
    $wsData.Cells.Item(2, 3).Value2 = '블러핑확률'
    $wsData.Cells.Item(2, 4).Value2 = '다이임계'
    $wsData.Cells.Item(3, 1).Value2 = '1 초급'; $wsData.Cells.Item(3, 2).Value2 = 0;    $wsData.Cells.Item(3, 3).Value2 = 0;    $wsData.Cells.Item(3, 4).Value2 = 0.3
    $wsData.Cells.Item(4, 1).Value2 = '2 중급'; $wsData.Cells.Item(4, 2).Value2 = 0.05; $wsData.Cells.Item(4, 3).Value2 = 0.1;  $wsData.Cells.Item(4, 4).Value2 = 0.34
    $wsData.Cells.Item(5, 1).Value2 = '3 고급'; $wsData.Cells.Item(5, 2).Value2 = 0.1;  $wsData.Cells.Item(5, 3).Value2 = 0.16; $wsData.Cells.Item(5, 4).Value2 = 0.38

    # ===== Save 시트 (저장 슬롯) =====
    $saveLabels = @('내 자금', '인원수', '승', '패', '(예비)', '난이도', '하프횟수', '콜횟수', '다이횟수', '최대판돈')
    $saveInit   = @(10000, 2, 0, 0, 0, 2, 0, 0, 0, 0)
    for ($i = 0; $i -lt 10; $i++) {
        $wsSave.Cells.Item($i + 1, 1).Value2 = $saveLabels[$i]
        $wsSave.Cells.Item($i + 1, 2).Value2 = [double]$saveInit[$i]
    }

    # ===== VBA 주입 =====
    try {
        $vbproj = $wb.VBProject
    } catch {
        throw 'VBA 프로젝트에 접근할 수 없습니다. Excel 옵션 > 보안 센터 > 매크로 설정에서 "VBA 프로젝트 개체 모델에 안전하게 액세스할 수 있음"을 켠 뒤 다시 실행하세요.'
    }
    foreach ($f in Get-ChildItem (Join-Path $vbaDir '*.bas')) {
        $code = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
        $comp = $vbproj.VBComponents.Add(1)   # 표준 모듈
        $comp.Name = $f.BaseName
        $comp.CodeModule.AddFromString($code)
        # AddFromString이 모듈 끝에 남기는 쓰레기 줄("()" 등) 제거
        # (남아 있으면 마지막 프로시저 호출 시 컴파일 오류 모달로 멈춤)
        $cm = $comp.CodeModule
        while ($cm.CountOfLines -gt 0) {
            $last = $cm.Lines($cm.CountOfLines, 1).Trim()
            if ($last -eq '()' -or $last -eq '(') {
                Write-Host "  경고: $($f.BaseName) 끝의 쓰레기 줄 '$last' 제거"
                $cm.DeleteLines($cm.CountOfLines, 1)
            } else {
                break
            }
        }
        Write-Host "모듈 주입: $($f.BaseName)"
    }
    $twbCode = [IO.File]::ReadAllText((Join-Path $vbaDir 'ThisWorkbook.txt'), [Text.Encoding]::UTF8)
    $vbproj.VBComponents.Item($wb.CodeName).CodeModule.AddFromString($twbCode)
    Write-Host '모듈 주입: ThisWorkbook'

    # ===== 화면 설정 및 시트 숨김 =====
    $wsGame.Activate()
    $xl.ActiveWindow.DisplayGridlines = $false
    $xl.ActiveWindow.DisplayHeadings = $false
    $xl.ActiveWindow.DisplayWorkbookTabs = $false
    $wsAssets.Visible = 2   # xlSheetVeryHidden
    $wsData.Visible = 2
    $wsSave.Visible = 2

    # ===== 자체 테스트 =====
    $res = $xl.Run('SelfTest')
    Write-Host "SelfTest: $res"
    if ($res -ne 'OK') { throw "SelfTest 실패: $res" }

    # ===== 저장 =====
    $wb.SaveAs($out, 52)   # xlsm
    $wb.Close($false)
    $xl.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
    $xl = $null
    Write-Host "저장 완료: $out"

    # ===== 재오픈 검증 (Workbook_Open 실행 확인) =====
    $xl2 = New-Object -ComObject Excel.Application
    try {
        $xl2.Visible = $false
        $xl2.DisplayAlerts = $false
        $xl2.AutomationSecurity = 1   # 매크로 허용 (msoAutomationSecurityLow)
        $wb2 = $xl2.Workbooks.Open($out)
        $g = $wb2.Worksheets.Item('Game')
        $titleVisible = $g.Shapes.Item('title_bg').Visible
        $protected = $g.ProtectContents
        $res2 = $xl2.Run('SelfTest')
        Write-Host "재오픈 검증: title_bg 표시=$titleVisible / 시트보호=$protected / SelfTest=$res2"
        if (-not $titleVisible) { throw 'Workbook_Open이 타이틀 화면을 띄우지 못했습니다.' }
        if ($res2 -ne 'OK') { throw "재오픈 SelfTest 실패: $res2" }
        $wb2.Close($true)
    } finally {
        $xl2.Quit()
        [Runtime.InteropServices.Marshal]::ReleaseComObject($xl2) | Out-Null
    }
    Write-Host '빌드 및 검증 성공'
}
finally {
    if ($null -ne $xl) {
        try { $xl.Quit() } catch {}
        try { [Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
