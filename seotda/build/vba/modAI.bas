Option Explicit

' Data 시트에서 난이도별 파라미터 읽기 (공격성/블러핑확률/다이임계)
Private Sub GetParams(ByRef agg As Double, ByRef bluff As Double, ByRef dieTh As Double)
    On Error GoTo fallback
    With ThisWorkbook.Worksheets("Data")
        agg = CDbl(.Cells(2 + gDifficulty, 2).Value)
        bluff = CDbl(.Cells(2 + gDifficulty, 3).Value)
        dieTh = CDbl(.Cells(2 + gDifficulty, 4).Value)
    End With
    Exit Sub
fallback:
    agg = 0.05: bluff = 0.1: dieTh = 0.34
End Sub

' 좌석별 판단: 핸드 강도 + 콜 비용 + 성향(개성 포함) + 난수 → CALL / HALF / DIE
Public Function Decide(seat As Integer) As String
    Dim rank As Integer, s As Double
    rank = modHand.HandRank(gCards(seat, 1), gCards(seat, 2))
    s = modHand.Strength(rank)

    ' 특수 패 보정: 잡기 가능성이 있는 패는 실제 끗수보다 세게 본다
    If modHand.IsDdaengJabi(gCards(seat, 1), gCards(seat, 2)) Then
        If s < 0.55 Then s = 0.55
    ElseIf modHand.IsAmhaeng(gCards(seat, 1), gCards(seat, 2)) Then
        If s < 0.5 Then s = 0.5
    End If

    Dim agg As Double, bluff As Double, dieTh As Double
    GetParams agg, bluff, dieTh

    Dim owed As Long
    owed = gCurBet - gPaid(seat)
    If owed < 0 Then owed = 0

    Dim score As Double
    score = s + (Rnd() - 0.5) * 0.14 + (agg + gAggOff(seat)) * 0.1

    ' 다인전 보정: 상대가 많을수록 신중하게
    score = score - (modMain.ActiveCount() - 2) * 0.03

    ' 중급 이상: 판돈 대비 콜 비용 반영
    If gDifficulty >= 2 And owed > 0 Then
        score = score - (owed / (gPot + owed)) * 0.3
    End If
    ' 고급: 플레이어 베팅 성향 반영 (하프가 잦은 상대의 레이즈는 가볍게 봄)
    If gDifficulty >= 3 And owed > 0 Then
        score = score + (modSave.PlayerHalfRate() - 0.3) * 0.25
    End If

    ' 블러핑: 약한 패로 하프
    If s < 0.35 And Rnd() < bluff Then
        Decide = "HALF"
        Exit Function
    End If

    If owed > 0 And score < dieTh Then
        Decide = "DIE"
    ElseIf owed > 0 And score > 0.8 And modBetting.CanDdadang(seat) Then
        Decide = "DDANG"
    ElseIf score > 0.62 Then
        Decide = "HALF"
    Else
        Decide = "CALL"
    End If
End Function
