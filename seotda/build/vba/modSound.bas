Option Explicit

' 사운드 제거됨: 윈도우 시스템 경고음을 빌려 쓰던 효과음이 거슬려서 전부 무음 처리.
' 호출부(modMain/modUI)는 그대로 두기 위해 빈 프로시저만 유지한다.

Public Sub PlayCard()
End Sub

Public Sub PlayChip()
End Sub

Public Sub PlayWin()
End Sub

Public Sub PlayLose()
End Sub

Public Sub PlayFold()
End Sub

' 모듈 마지막 프로시저 호출이 멈추는 현상 보호용 패딩 (호출되지 않음)
Private Sub zzPad()
    Dim dummy As Integer
    dummy = 0
End Sub
