Option Explicit

#If VBA7 Then
Private Declare PtrSafe Function PlaySoundA Lib "winmm.dll" _
    (ByVal lpszName As String, ByVal hModule As LongPtr, ByVal dwFlags As Long) As Long
#Else
Private Declare Function PlaySoundA Lib "winmm.dll" _
    (ByVal lpszName As String, ByVal hModule As Long, ByVal dwFlags As Long) As Long
#End If

Private Const SND_ASYNC As Long = &H1
Private Const SND_ALIAS As Long = &H10000

Private Sub PlayAlias(nm As String)
    On Error Resume Next
    modTest.T "PlayAlias 시작: " & nm
    PlaySoundA nm, 0, SND_ASYNC Or SND_ALIAS
    modTest.T "PlayAlias 끝: " & nm
End Sub

Public Sub PlayCard()
    PlayAlias "SystemDefault"
End Sub

Public Sub PlayChip()
    PlayAlias "SystemAsterisk"
End Sub

Public Sub PlayWin()
    PlayAlias "SystemExclamation"
End Sub

Public Sub PlayLose()
    PlayAlias "SystemHand"
End Sub

Public Sub PlayFold()
    modTest.T "PlayFold 진입"
    PlayAlias "SystemHand"
End Sub

' 모듈 마지막 프로시저 호출이 멈추는 현상 보호용 패딩 (호출되지 않음)
Private Sub zzPad()
    Dim dummy As Integer
    dummy = 0
End Sub
