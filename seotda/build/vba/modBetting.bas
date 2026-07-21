Option Explicit

' 좌석 기반 베팅 엔진. side 대신 seat(0=플레이어, 1~4=AI)을 쓴다.

' seat를 제외한 활성 좌석 중 최소 자금 (전원이 콜할 수 있는 레이즈 한도)
Public Function MinOtherMoney(seat As Integer) As Long
    Dim i As Integer, m As Long
    m = 2147483647
    For i = 0 To gNumPlayers - 1
        If i <> seat And Not gFolded(i) Then
            If gMoney(i) < m Then m = gMoney(i)
        End If
    Next i
    If m = 2147483647 Then m = 0
    MinOtherMoney = m
End Function

Public Function CanRaise(seat As Integer) As Boolean
    CanRaise = False
    If gRaiseCount >= MAX_RAISES Then Exit Function
    Dim owed As Long
    owed = gCurBet - gPaid(seat)
    If owed < 0 Then owed = 0
    If gMoney(seat) <= owed Then Exit Function
    If MinOtherMoney(seat) <= 0 Then Exit Function
    CanRaise = True
End Function

' 따당: 직전 레이즈가 있어야 가능 (직전 레이즈액의 2배로 올림)
Public Function CanDdadang(seat As Integer) As Boolean
    CanDdadang = False
    If gLastRaise <= 0 Then Exit Function
    If Not CanRaise(seat) Then Exit Function
    CanDdadang = True
End Function

Public Sub ApplyAction(seat As Integer, act As String)
    Dim owed As Long, pay As Long, r As Long
    owed = gCurBet - gPaid(seat)
    If owed < 0 Then owed = 0

    Select Case act
    Case "DIE"
        modTest.T "ApplyAction DIE: seat=" & seat
        gFolded(seat) = True
        gToAct = gToAct - 1
        modUI.ShowFold seat

    Case "CALL"
        pay = owed
        If pay > gMoney(seat) Then pay = gMoney(seat)
        gMoney(seat) = gMoney(seat) - pay
        gPaid(seat) = gPaid(seat) + pay
        gPot = gPot + pay
        gToAct = gToAct - 1
        If pay > 0 Then modUI.ThrowMoney seat

    Case "HALF", "DDANG"
        ' 1) 콜 몫 지불
        pay = owed
        If pay > gMoney(seat) Then pay = gMoney(seat)
        gMoney(seat) = gMoney(seat) - pay
        gPaid(seat) = gPaid(seat) + pay
        gPot = gPot + pay
        ' 2) 레이즈: 하프 = 판돈의 절반 / 따당 = 직전 레이즈의 2배
        If act = "DDANG" Then
            r = gLastRaise * 2
        Else
            r = gPot \ 2
        End If
        If r > gMoney(seat) Then r = gMoney(seat)
        If r > MinOtherMoney(seat) Then r = MinOtherMoney(seat)
        If r <= 0 Then
            gToAct = gToAct - 1          ' 사실상 콜
        Else
            gMoney(seat) = gMoney(seat) - r
            gPaid(seat) = gPaid(seat) + r
            gPot = gPot + r
            gCurBet = gPaid(seat)
            gLastRaise = r
            gRaiseCount = gRaiseCount + 1
            gToAct = ActiveCount() - 1   ' 나머지 전원이 다시 응답
        End If
        If pay > 0 Or r > 0 Then modUI.ThrowMoney seat
    End Select
End Sub
