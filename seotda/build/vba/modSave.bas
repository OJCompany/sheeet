Option Explicit

' Save 시트 레이아웃
'  B1 내 자금  B2 인원수  B3 승  B4 패  B5 (예비)
'  B6 난이도  B7 하프 횟수  B8 콜 횟수  B9 다이 횟수  B10 최대판돈

Private Function WS() As Worksheet
    Set WS = ThisWorkbook.Worksheets("Save")
End Function

Public Sub SaveState()
    On Error Resume Next
    WS.Range("B1").Value = gMoney(0)
    WS.Range("B2").Value = gSelCount
    WS.Range("B6").Value = gDifficulty
End Sub

Public Sub LoadState()
    On Error Resume Next
    gMoney(0) = Val(WS.Range("B1").Value)
    If gMoney(0) <= 0 Then gMoney(0) = START_MONEY
    gSelCount = Val(WS.Range("B2").Value)
    If gSelCount < 2 Or gSelCount > MAX_SEATS Then gSelCount = 2
    gDifficulty = Val(WS.Range("B6").Value)
    If gDifficulty < 1 Or gDifficulty > 3 Then gDifficulty = 2
End Sub

Public Sub RecordPlayerAction(act As String)
    On Error Resume Next
    Dim addr As String
    Select Case act
        Case "HALF", "DDANG": addr = "B7"   ' 레이즈 성향으로 함께 집계
        Case "CALL": addr = "B8"
        Case "DIE": addr = "B9"
        Case Else: Exit Sub
    End Select
    WS.Range(addr).Value = Val(WS.Range(addr).Value) + 1
End Sub

' 플레이어의 하프 비율 (표본 8회 미만이면 기본값 0.3)
Public Function PlayerHalfRate() As Double
    Dim h As Double, t As Double
    h = Val(WS.Range("B7").Value)
    t = h + Val(WS.Range("B8").Value) + Val(WS.Range("B9").Value)
    If t < 8 Then
        PlayerHalfRate = 0.3
    Else
        PlayerHalfRate = h / t
    End If
End Function

Public Sub RecordResult(playerWon As Boolean, pot As Long)
    On Error Resume Next
    If playerWon Then
        WS.Range("B3").Value = Val(WS.Range("B3").Value) + 1
    Else
        WS.Range("B4").Value = Val(WS.Range("B4").Value) + 1
    End If
    If pot > Val(WS.Range("B10").Value) Then WS.Range("B10").Value = pot
    SaveState
End Sub

Public Function GetWins() As Long
    On Error Resume Next
    GetWins = Val(WS.Range("B3").Value)
End Function

Public Function GetLosses() As Long
    On Error Resume Next
    GetLosses = Val(WS.Range("B4").Value)
End Function
