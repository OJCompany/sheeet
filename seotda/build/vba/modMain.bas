Option Explicit

' ===== 상수 =====
Public Const MAX_SEATS As Integer = 5          ' 본인 포함 최대 5인 (한게임 섯다 기준)
Public Const ANTE As Long = 100
Public Const START_MONEY As Long = 10000
Public Const MAX_RAISES As Integer = 4

' ===== 전역 게임 상태 (좌석 0 = 플레이어, 1~4 = AI) =====
Public gNumPlayers As Integer                  ' 이번 게임 참가 인원 (2~5)
Public gCards(0 To 4, 1 To 2) As Integer
Public gMoney(0 To 4) As Long
Public gFolded(0 To 4) As Boolean              ' 이번 판 다이 (탈락 좌석은 판 시작 시 폴드 처리)
Public gOut(0 To 4) As Boolean                 ' 파산으로 게임에서 제외
Public gPaid(0 To 4) As Long                   ' 이번 판 납입액
Public gAggOff(0 To 4) As Double               ' AI 개성 (공격성 오프셋)
Public gPot As Long
Public gCarryPot As Long
Public gCurBet As Long                         ' 이번 판 1인당 요구 납입액
Public gLastRaise As Long                      ' 직전 레이즈액 (따당 기준액)
Public gRaiseCount As Integer
Public gToAct As Integer                       ' 아직 행동해야 하는 활성 인원 수
Public gTurn As Integer
Public gDifficulty As Integer                  ' 1 초급 / 2 중급 / 3 고급
Public gSelCount As Integer                    ' 타이틀에서 선택한 인원수
Public gPhase As Integer                       ' 0 대기 / 1 베팅 / 2 쇼다운
Public gGameOver As Boolean

' ===== 헬퍼 =====
Public Function ActiveCount() As Integer
    Dim i As Integer, n As Integer
    For i = 0 To gNumPlayers - 1
        If Not gFolded(i) Then n = n + 1
    Next i
    ActiveCount = n
End Function

Public Function FirstActiveSeat() As Integer
    Dim i As Integer
    For i = 0 To gNumPlayers - 1
        If Not gFolded(i) Then FirstActiveSeat = i: Exit Function
    Next i
    FirstActiveSeat = 0
End Function

Private Function AliveOpponents() As Integer
    Dim i As Integer, n As Integer
    For i = 1 To gNumPlayers - 1
        If Not gOut(i) And gMoney(i) >= ANTE Then n = n + 1
    Next i
    AliveOpponents = n
End Function

' ===== 앱 시작/종료 =====
Public Sub InitApp()
    Randomize
    Application.DisplayFormulaBar = False
    On Error Resume Next
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
    ActiveWindow.DisplayWorkbookTabs = False
    On Error GoTo 0
    With ThisWorkbook.Worksheets("Game")
        .Activate
        .ScrollArea = "A1:S40"
        .Protect UserInterfaceOnly:=True
        .EnableSelection = xlNoSelection
    End With
    gDifficulty = 2
    gSelCount = 2
    modSave.LoadState
    gNumPlayers = gSelCount
    modUI.InitDeckPile
    modUI.RenderAvatar 0
    modUI.ShowTitleScreen
End Sub

Public Sub CleanupApp()
    modSave.SaveState
    Application.DisplayFormulaBar = True
End Sub

' ===== 타이틀: 인원 선택 =====
Public Sub OnCount2()
    SetCount 2
End Sub
Public Sub OnCount3()
    SetCount 3
End Sub
Public Sub OnCount4()
    SetCount 4
End Sub
Public Sub OnCount5()
    SetCount 5
End Sub

Private Sub SetCount(n As Integer)
    On Error Resume Next
    gSelCount = n
    modUI.HighlightCount
End Sub

' ===== 타이틀: 난이도 선택 & 시작 =====
Public Sub OnEasy()
    StartWithDiff 1
End Sub
Public Sub OnNormal()
    StartWithDiff 2
End Sub
Public Sub OnHard()
    StartWithDiff 3
End Sub

Private Sub StartWithDiff(d As Integer)
    On Error GoTo eh
    gDifficulty = d
    gNumPlayers = gSelCount
    If gNumPlayers < 2 Or gNumPlayers > MAX_SEATS Then gNumPlayers = 2
    If gMoney(0) < ANTE Then gMoney(0) = START_MONEY
    Dim i As Integer
    For i = 1 To MAX_SEATS - 1
        If i <= gNumPlayers - 1 Then
            gMoney(i) = START_MONEY
            gOut(i) = False
            gAggOff(i) = (Rnd() - 0.5) * 0.12
        Else
            gOut(i) = True
        End If
    Next i
    gCarryPot = 0
    gGameOver = False
    modSave.SaveState
    modUI.ShowGameScreen
    NewRound
    Exit Sub
eh:
    modUI.SetMessage "오류가 발생했습니다: " & Err.Description
End Sub

' ===== 라운드 진행 =====
Public Sub NewRound()
    Dim i As Integer
    If gGameOver Then
        gMoney(0) = START_MONEY
        For i = 1 To gNumPlayers - 1
            gMoney(i) = START_MONEY
            gOut(i) = False
        Next i
        gCarryPot = 0
        gGameOver = False
        modUI.UpdateLabels
    End If
    If gMoney(0) < ANTE Then
        GameOver False
        Exit Sub
    End If
    For i = 1 To gNumPlayers - 1
        If Not gOut(i) And gMoney(i) < ANTE Then gOut(i) = True
    Next i
    If AliveOpponents() = 0 Then
        GameOver True
        Exit Sub
    End If

    gPot = gCarryPot: gCarryPot = 0
    gCurBet = 0: gRaiseCount = 0: gLastRaise = 0
    For i = 0 To gNumPlayers - 1
        gPaid(i) = 0
        gFolded(i) = gOut(i)          ' 탈락 좌석은 폴드 상태로 시작
        If Not gFolded(i) Then
            gMoney(i) = gMoney(i) - ANTE
            gPot = gPot + ANTE
        End If
    Next i
    gToAct = ActiveCount()

    modDeck.ShuffleDeck
    Dim c As Integer
    For c = 1 To 2
        For i = 0 To gNumPlayers - 1
            If Not gFolded(i) Then gCards(i, c) = modDeck.Draw()
        Next i
    Next c

    gPhase = 1
    gTurn = 0
    modUI.PrepareRound
    modUI.UpdateLabels
    modUI.SetMessage "패를 돌립니다..."
    modUI.DealAnimation
    modUI.ShowPlayerHandName
    modUI.SetMessage "베팅하세요."
    modUI.EnableButtons True
End Sub

Private Sub GameOver(won As Boolean)
    gGameOver = True
    gPhase = 0
    If won Then
        modUI.SetMessage "모든 AI 파산! 완승입니다!"
        modSound.PlayWin
    Else
        modUI.SetMessage "파산했습니다... 게임 오버"
        modSound.PlayLose
    End If
    modUI.ShowNextButton "새 게임 (자금 초기화)"
End Sub

' ===== 플레이어 액션 =====
Public Sub OnCall()
    PlayerAction "CALL"
End Sub
Public Sub OnHalf()
    PlayerAction "HALF"
End Sub
Public Sub OnDdadang()
    PlayerAction "DDANG"
End Sub
Public Sub OnDie()
    PlayerAction "DIE"
End Sub

Public Sub OnNextRound()
    On Error GoTo eh
    modUI.HideNextButton
    NewRound
    Exit Sub
eh:
    modUI.SetMessage "오류가 발생했습니다: " & Err.Description
End Sub

Public Sub OnBackToTitle()
    On Error GoTo eh
    If gPhase = 1 Then
        modUI.SetMessage "판이 끝난 뒤에 나갈 수 있습니다."
        Exit Sub
    End If
    modSave.SaveState
    modUI.ShowTitleScreen
    Exit Sub
eh:
    modUI.SetMessage "오류가 발생했습니다: " & Err.Description
End Sub

Private Sub PlayerAction(act As String)
    On Error GoTo eh
    If gPhase <> 1 Or gTurn <> 0 Or gFolded(0) Then Exit Sub
    modTest.T "PlayerAction 시작: " & act
    If act = "DDANG" And Not modBetting.CanDdadang(0) Then act = "HALF"
    If act = "HALF" And Not modBetting.CanRaise(0) Then act = "CALL"
    modUI.EnableButtons False
    modSave.RecordPlayerAction act
    If act = "DIE" Then
        modSound.PlayFold
    Else
        modSound.PlayChip
    End If
    modBetting.ApplyAction 0, act
    ShowActionMsg 0, act
    modUI.UpdateLabels
    Resolve
    If gPhase = 1 Then RunBetting
    Exit Sub
eh:
    modUI.SetMessage "오류가 발생했습니다: " & Err.Description
End Sub

' ===== 턴 진행 엔진 =====
' 행동 후 종료 조건 검사, 아니면 다음 턴으로
Private Sub Resolve()
    If gPhase <> 1 Then Exit Sub
    If ActiveCount() = 1 Then
        EndRound FirstActiveSeat(), True
    ElseIf gToAct <= 0 Then
        Showdown
    Else
        AdvanceTurn
    End If
End Sub

Private Sub AdvanceTurn()
    Dim guard As Integer
    Do
        gTurn = (gTurn + 1) Mod gNumPlayers
        guard = guard + 1
        If guard > MAX_SEATS + 1 Then Exit Do
    Loop While gFolded(gTurn)
End Sub

' 플레이어 차례가 오거나 판이 끝날 때까지 AI 턴을 자동 진행
Private Sub RunBetting()
    Do While gPhase = 1
        If gTurn = 0 And Not gFolded(0) Then
            PromptPlayer
            Exit Do
        End If
        AITakeTurn gTurn
    Loop
End Sub

Private Sub PromptPlayer()
    Dim owed As Long
    owed = gCurBet - gPaid(0)
    If owed > 0 Then
        If modBetting.CanDdadang(0) Then
            modUI.SetMessage "콜 " & Format(owed, "#,0") & "P / 하프 / 따당 / 다이"
        Else
            modUI.SetMessage "콜 " & Format(owed, "#,0") & "P / 하프 / 다이"
        End If
    Else
        modUI.SetMessage "베팅하세요."
    End If
    modUI.EnableButtons True
End Sub

Private Sub AITakeTurn(seat As Integer)
    modUI.SetMessage modUI.SeatName(seat) & " 고민 중..."
    modUI.Pause 350 + Rnd() * 650
    Dim act As String
    act = modAI.Decide(seat)
    If act = "DDANG" And Not modBetting.CanDdadang(seat) Then act = "HALF"
    If act = "HALF" And Not modBetting.CanRaise(seat) Then act = "CALL"
    modBetting.ApplyAction seat, act
    ShowActionMsg seat, act
    If act <> "DIE" Then modSound.PlayChip
    modUI.UpdateLabels
    modUI.Pause 350
    Resolve
End Sub

Private Sub ShowActionMsg(seat As Integer, act As String)
    Dim nm As String
    nm = modUI.SeatName(seat)
    Select Case act
        Case "DIE": modUI.SetMessage nm & ": 다이"
        Case "HALF": modUI.SetMessage nm & ": 하프!"
        Case "DDANG": modUI.SetMessage nm & ": 따당!!"
        Case Else: modUI.SetMessage nm & ": 콜"
    End Select
End Sub

' ===== 쇼다운/정산 =====
' 특수 규칙 포함 판정 (테스트 가능한 순수 함수)
'  반환: "GUSA:<이름>" 재경기 / "TIE" 무승부 / "W:<좌석>:<특수명 또는 빈칸>"
Public Function Judge() As String
    Dim i As Integer, r As Integer, best As Integer
    Dim hasMong As Boolean, hasGusa As Boolean
    best = -1
    For i = 0 To gNumPlayers - 1
        If Not gFolded(i) Then
            r = modHand.HandRank(gCards(i, 1), gCards(i, 2))
            If r > best Then best = r
            If modHand.IsMongGusa(gCards(i, 1), gCards(i, 2)) Then
                hasMong = True
            ElseIf modHand.IsGusa(gCards(i, 1), gCards(i, 2)) Then
                hasGusa = True
            End If
        End If
    Next i

    ' 1) 구사 재경기 (광땡은 랭크가 810보다 커서 자동 제외)
    If hasMong And best <= 810 Then
        Judge = "GUSA:멍텅구리구사"
        Exit Function
    End If
    If hasGusa And best <= 750 Then
        Judge = "GUSA:구사"
        Exit Function
    End If

    ' 2) 땡잡이: 최고가 1~9땡일 때 3·7이 잡는다
    Dim catcher As Integer, catchCnt As Integer
    If best >= 801 And best <= 809 Then
        catchCnt = 0
        For i = 0 To gNumPlayers - 1
            If Not gFolded(i) Then
                If modHand.IsDdaengJabi(gCards(i, 1), gCards(i, 2)) Then
                    catcher = i
                    catchCnt = catchCnt + 1
                End If
            End If
        Next i
        If catchCnt = 1 Then
            Judge = "W:" & catcher & ":땡잡이"
            Exit Function
        ElseIf catchCnt > 1 Then
            Judge = "TIE"
            Exit Function
        End If
    End If

    ' 3) 암행어사: 최고가 13·18광땡일 때 4·7 열끗이 잡는다
    If best = 905 Or best = 910 Then
        For i = 0 To gNumPlayers - 1
            If Not gFolded(i) Then
                If modHand.IsAmhaeng(gCards(i, 1), gCards(i, 2)) Then
                    Judge = "W:" & i & ":암행어사"
                    Exit Function
                End If
            End If
        Next i
    End If

    ' 4) 일반 비교
    Dim winner As Integer, winCnt As Integer
    winCnt = 0
    For i = 0 To gNumPlayers - 1
        If Not gFolded(i) Then
            If modHand.HandRank(gCards(i, 1), gCards(i, 2)) = best Then
                winner = i
                winCnt = winCnt + 1
            End If
        End If
    Next i
    If winCnt = 1 Then
        Judge = "W:" & winner & ":"
    Else
        Judge = "TIE"
    End If
End Function

Public Sub Showdown()
    gPhase = 2
    modUI.EnableButtons False
    modUI.UpdateLabels
    modUI.SetMessage "패 공개!"
    modUI.Pause 300
    Dim i As Integer
    For i = 1 To gNumPlayers - 1
        If Not gFolded(i) Then modUI.RevealSeat i
    Next i
    modUI.ShowHandNames
    modUI.Pause 500

    Dim res As String
    res = Judge()
    If Left(res, 5) = "GUSA:" Then
        gCarryPot = gPot
        gPot = 0
        gPhase = 0
        modSound.PlayChip
        modUI.SetMessage Mid(res, 6) & "! 판돈 " & Format(gCarryPot, "#,0") & "P 이월 - 재경기"
        modUI.ShowNextButton "재경기"
        modSave.SaveState
    ElseIf res = "TIE" Then
        gCarryPot = gPot
        gPot = 0
        gPhase = 0
        modSound.PlayChip
        modUI.SetMessage "무승부! 판돈 " & Format(gCarryPot, "#,0") & "P 이월 - 재경기"
        modUI.ShowNextButton "재경기"
        modSave.SaveState
    Else
        Dim parts() As String, winner As Integer, special As String
        parts = Split(res, ":")
        winner = CInt(parts(1))
        special = parts(2)
        If special <> "" Then
            modSound.PlayWin
            modUI.SetMessage special & "! " & modUI.SeatName(winner) & "가 잡았습니다!"
            modUI.Pause 900
        End If
        EndRound winner, False
    End If
End Sub

Public Sub EndRound(winner As Integer, byFold As Boolean)
    modTest.T "EndRound 시작: winner=" & winner & " fold=" & byFold
    gPhase = 0
    modUI.EnableButtons False
    Dim wonPot As Long
    wonPot = gPot
    gMoney(winner) = gMoney(winner) + gPot
    If winner = 0 Then
        modSound.PlayWin
        If byFold Then
            modUI.SetMessage "전원 다이! +" & Format(wonPot, "#,0") & "P 획득"
        Else
            modUI.SetMessage modHand.HandLabel(gCards(0, 1), gCards(0, 2)) & " 승리! +" & Format(wonPot, "#,0") & "P"
        End If
    Else
        modSound.PlayLose
        If byFold Then
            modUI.SetMessage modUI.SeatName(winner) & " 승리 (나머지 전원 다이)"
        Else
            modUI.SetMessage modUI.SeatName(winner) & "의 " & modHand.HandLabel(gCards(winner, 1), gCards(winner, 2)) & " - " & Format(wonPot, "#,0") & "P 획득"
        End If
    End If
    modSave.RecordResult (winner = 0), wonPot
    gPot = 0
    modUI.UpdateLabels
    If gMoney(0) < ANTE Then
        modUI.Pause 900
        GameOver False
    ElseIf AliveOpponents() = 0 Then
        modUI.Pause 900
        GameOver True
    Else
        modUI.ShowNextButton "다음 판"
    End If
    modTest.T "EndRound 끝"
End Sub
