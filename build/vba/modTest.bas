Option Explicit

' ===== 디버그 트레이스 (기본 꺼짐) =====
Public gTrace As Boolean

Public Sub TraceOn()
    gTrace = True
End Sub

Public Sub FastOn()
    modUI.gFast = True
End Sub

Public Sub T(s As String)
    If Not gTrace Then Exit Sub
    On Error Resume Next
    Dim f As Integer
    f = FreeFile
    Open ThisWorkbook.Path & "\trace.log" For Append As #f
    Print #f, Format(Now, "hh:mm:ss") & " " & s
    Close #f
End Sub

' E2E 테스트용 상태 조회 (phase|pot|carry|내자금|AI자금합|내가낼콜비용)
Public Function StateString() As String
    Dim i As Integer, aiSum As Long, owed As Long
    For i = 1 To gNumPlayers - 1
        aiSum = aiSum + gMoney(i)
    Next i
    owed = gCurBet - gPaid(0)
    If owed < 0 Then owed = 0
    StateString = gPhase & "|" & gPot & "|" & gCarryPot & "|" & gMoney(0) & "|" & aiSum & "|" & owed
End Function

' 빌드 검증용 자체 테스트 (UI를 건드리지 않음)
Public Function SelfTest() As String
    Dim msg As String

    ' --- 족보 판정 ---
    If modHand.HandRank(31, 81) <> 1000 Then msg = msg & "38광땡 FAIL; "
    If modHand.HandRank(11, 81) <> 910 Then msg = msg & "18광땡 FAIL; "
    If modHand.HandRank(11, 31) <> 905 Then msg = msg & "13광땡 FAIL; "
    If modHand.HandRank(101, 102) <> 810 Then msg = msg & "장땡 FAIL; "
    If modHand.HandRank(51, 52) <> 805 Then msg = msg & "5땡 FAIL; "
    If modHand.HandRank(12, 21) <> 750 Then msg = msg & "알리 FAIL; "
    If modHand.HandRank(12, 41) <> 740 Then msg = msg & "독사 FAIL; "
    If modHand.HandRank(12, 91) <> 730 Then msg = msg & "구삥 FAIL; "
    If modHand.HandRank(12, 101) <> 720 Then msg = msg & "장삥 FAIL; "
    If modHand.HandRank(41, 101) <> 710 Then msg = msg & "장사 FAIL; "
    If modHand.HandRank(41, 61) <> 700 Then msg = msg & "세륙 FAIL; "
    If modHand.HandRank(12, 82) <> 109 Then msg = msg & "갑오 FAIL; "
    If modHand.HandRank(22, 82) <> 100 Then msg = msg & "망통 FAIL; "
    If modHand.HandRank(32, 82) <> 101 Then msg = msg & "1끗 FAIL; "
    If modHand.HandName(1000) <> "38광땡" Then msg = msg & "족보명 FAIL; "

    ' --- 덱: 20장 고유 ---
    Dim i As Integer, j As Integer
    Dim cards(1 To 20) As Integer
    Randomize
    modDeck.ShuffleDeck
    For i = 1 To 20
        cards(i) = modDeck.Draw()
    Next i
    For i = 1 To 19
        For j = i + 1 To 20
            If cards(i) = cards(j) Then msg = msg & "덱 중복 FAIL; ": GoTo deckDone
        Next j
    Next i
deckDone:

    ' --- AI: 항상 유효한 행동을 반환하는지 (전역 상태는 끝나면 복원) ---
    Dim sDiff As Integer, sPot As Long, sCurBet As Long, sNum As Integer, sRaise As Integer
    Dim sM0 As Long, sM1 As Long, sP1 As Long, sC1 As Integer, sC2 As Integer
    Dim sF0 As Boolean, sF1 As Boolean, sAgg As Double
    sDiff = gDifficulty: sPot = gPot: sCurBet = gCurBet: sNum = gNumPlayers: sRaise = gRaiseCount
    sM0 = gMoney(0): sM1 = gMoney(1): sP1 = gPaid(1): sC1 = gCards(1, 1): sC2 = gCards(1, 2)
    sF0 = gFolded(0): sF1 = gFolded(1): sAgg = gAggOff(1)

    gDifficulty = 3: gPot = 400: gCurBet = 300: gNumPlayers = 2: gRaiseCount = 1
    gMoney(0) = 5000: gMoney(1) = 5000: gPaid(1) = 100
    gFolded(0) = False: gFolded(1) = False: gAggOff(1) = 0.05
    Dim a As String
    For i = 1 To 200
        gCards(1, 1) = (Int(Rnd() * 10) + 1) * 10 + Int(Rnd() * 2) + 1
        gCards(1, 2) = (Int(Rnd() * 10) + 1) * 10 + Int(Rnd() * 2) + 1
        If gCards(1, 1) = gCards(1, 2) Then gCards(1, 2) = gCards(1, 1) - 9
        a = modAI.Decide(1)
        If a <> "CALL" And a <> "HALF" And a <> "DIE" Then
            msg = msg & "AI 행동 FAIL(" & a & "); "
            Exit For
        End If
    Next i

    gDifficulty = sDiff: gPot = sPot: gCurBet = sCurBet: gNumPlayers = sNum: gRaiseCount = sRaise
    gMoney(0) = sM0: gMoney(1) = sM1: gPaid(1) = sP1: gCards(1, 1) = sC1: gCards(1, 2) = sC2
    gFolded(0) = sF0: gFolded(1) = sF1: gAggOff(1) = sAgg

    ' --- v2 특수 패 판정 ---
    If Not modHand.IsDdaengJabi(32, 72) Then msg = msg & "땡잡이판정 FAIL; "
    If Not modHand.IsDdaengJabi(31, 71) Then msg = msg & "땡잡이판정2 FAIL; "
    If modHand.IsDdaengJabi(32, 82) Then msg = msg & "땡잡이오탐 FAIL; "
    If Not modHand.IsAmhaeng(41, 71) Then msg = msg & "암행어사판정 FAIL; "
    If modHand.IsAmhaeng(42, 71) Then msg = msg & "암행어사오탐 FAIL; "
    If Not modHand.IsGusa(42, 92) Then msg = msg & "구사판정 FAIL; "
    If Not modHand.IsMongGusa(41, 91) Then msg = msg & "멍구사판정 FAIL; "
    If modHand.HandLabel(32, 72) <> "망통·땡잡이" Then msg = msg & "라벨 FAIL; "

    ' --- v2 쇼다운 판정 (Judge) ---
    Dim jNum As Integer
    Dim jf(0 To 2) As Boolean
    Dim jcc(0 To 2, 1 To 2) As Integer
    jNum = gNumPlayers
    For i = 0 To 2
        jf(i) = gFolded(i)
        jcc(i, 1) = gCards(i, 1): jcc(i, 2) = gCards(i, 2)
    Next i

    gNumPlayers = 2
    gFolded(0) = False: gFolded(1) = False: gFolded(2) = False
    gCards(0, 1) = 51: gCards(0, 2) = 52: gCards(1, 1) = 32: gCards(1, 2) = 72
    If modMain.Judge() <> "W:1:땡잡이" Then msg = msg & "J1(땡잡이) FAIL; "
    gCards(0, 1) = 101: gCards(0, 2) = 102
    If modMain.Judge() <> "W:0:" Then msg = msg & "J2(장땡불가) FAIL; "
    gCards(0, 1) = 11: gCards(0, 2) = 81: gCards(1, 1) = 41: gCards(1, 2) = 71
    If modMain.Judge() <> "W:1:암행어사" Then msg = msg & "J3(암행어사) FAIL; "
    gCards(0, 1) = 31: gCards(0, 2) = 81
    If modMain.Judge() <> "W:0:" Then msg = msg & "J4(38불가) FAIL; "
    gCards(0, 1) = 12: gCards(0, 2) = 21: gCards(1, 1) = 42: gCards(1, 2) = 92
    If modMain.Judge() <> "GUSA:구사" Then msg = msg & "J5(구사) FAIL; "
    gCards(0, 1) = 51: gCards(0, 2) = 52
    If modMain.Judge() <> "W:0:" Then msg = msg & "J6(구사무효) FAIL; "
    gCards(0, 1) = 81: gCards(0, 2) = 82: gCards(1, 1) = 41: gCards(1, 2) = 91
    If modMain.Judge() <> "GUSA:멍텅구리구사" Then msg = msg & "J7(멍구사) FAIL; "
    gCards(0, 1) = 11: gCards(0, 2) = 31
    If modMain.Judge() <> "W:0:" Then msg = msg & "J8(멍구사무효) FAIL; "
    gCards(0, 1) = 12: gCards(0, 2) = 21: gCards(1, 1) = 11: gCards(1, 2) = 22
    If modMain.Judge() <> "TIE" Then msg = msg & "J9(무승부) FAIL; "
    gNumPlayers = 3
    gCards(0, 1) = 51: gCards(0, 2) = 52
    gCards(1, 1) = 31: gCards(1, 2) = 72
    gCards(2, 1) = 12: gCards(2, 2) = 21
    If modMain.Judge() <> "W:1:땡잡이" Then msg = msg & "J10(3인땡잡이) FAIL; "

    ' --- 따당 베팅 수학 (직전 레이즈의 2배) ---
    Dim dPot As Long, dM0 As Long, dM1 As Long, dP0 As Long, dP1 As Long
    Dim dCur As Long, dLast As Long, dRC As Integer, dTA As Integer
    dPot = gPot: dM0 = gMoney(0): dM1 = gMoney(1): dP0 = gPaid(0): dP1 = gPaid(1)
    dCur = gCurBet: dLast = gLastRaise: dRC = gRaiseCount: dTA = gToAct

    gNumPlayers = 2
    gFolded(0) = False: gFolded(1) = False
    gMoney(0) = 10000: gMoney(1) = 10000
    gPot = 400: gCurBet = 200: gPaid(0) = 200: gPaid(1) = 100
    gLastRaise = 100: gRaiseCount = 1: gToAct = 1
    modBetting.ApplyAction 1, "DDANG"
    ' 예상: 콜 100 → 판돈 500, 따당 200(=100x2) → 판돈 700, 자금 9700, 요구액 400, 직전레이즈 200
    If gPot <> 700 Or gMoney(1) <> 9700 Or gCurBet <> 400 Or gLastRaise <> 200 Or gRaiseCount <> 2 Then
        msg = msg & "따당수학 FAIL(" & gPot & "," & gMoney(1) & "," & gCurBet & "," & gLastRaise & "); "
    End If

    gPot = dPot: gMoney(0) = dM0: gMoney(1) = dM1: gPaid(0) = dP0: gPaid(1) = dP1
    gCurBet = dCur: gLastRaise = dLast: gRaiseCount = dRC: gToAct = dTA

    gNumPlayers = jNum
    For i = 0 To 2
        gFolded(i) = jf(i)
        gCards(i, 1) = jcc(i, 1): gCards(i, 2) = jcc(i, 2)
    Next i

    ' --- 강도 함수 단조성 샘플 ---
    If Not (modHand.Strength(1000) > modHand.Strength(810)) Then msg = msg & "강도1 FAIL; "
    If Not (modHand.Strength(810) > modHand.Strength(750)) Then msg = msg & "강도2 FAIL; "
    If Not (modHand.Strength(700) > modHand.Strength(109)) Then msg = msg & "강도3 FAIL; "
    If Not (modHand.Strength(109) > modHand.Strength(100)) Then msg = msg & "강도4 FAIL; "

    If msg = "" Then
        SelfTest = "OK"
    Else
        SelfTest = msg
    End If
End Function
