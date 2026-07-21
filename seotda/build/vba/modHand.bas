Option Explicit

' 족보 랭크 (클수록 강함)
'  1000        38광땡
'  910 / 905   18광땡 / 13광땡
'  800+월      땡 (장땡=810)
'  750~700     알리/독사/구삥/장삥/장사/세륙
'  100+끗      끗수 (갑오=109, 망통=100)
Public Function HandRank(c1 As Integer, c2 As Integer) As Integer
    Dim m1 As Integer, m2 As Integer, lo As Integer, hi As Integer
    m1 = modDeck.MonthOf(c1): m2 = modDeck.MonthOf(c2)
    If m1 < m2 Then
        lo = m1: hi = m2
    Else
        lo = m2: hi = m1
    End If

    If modDeck.IsGwang(c1) And modDeck.IsGwang(c2) Then
        If lo = 3 And hi = 8 Then HandRank = 1000: Exit Function
        If lo = 1 And hi = 8 Then HandRank = 910: Exit Function
        If lo = 1 And hi = 3 Then HandRank = 905: Exit Function
    End If
    If m1 = m2 Then HandRank = 800 + m1: Exit Function
    If lo = 1 And hi = 2 Then HandRank = 750: Exit Function
    If lo = 1 And hi = 4 Then HandRank = 740: Exit Function
    If lo = 1 And hi = 9 Then HandRank = 730: Exit Function
    If lo = 1 And hi = 10 Then HandRank = 720: Exit Function
    If lo = 4 And hi = 10 Then HandRank = 710: Exit Function
    If lo = 4 And hi = 6 Then HandRank = 700: Exit Function
    HandRank = 100 + ((m1 + m2) Mod 10)
End Function

Public Function HandName(rank As Integer) As String
    Select Case rank
        Case 1000: HandName = "38광땡"
        Case 910: HandName = "18광땡"
        Case 905: HandName = "13광땡"
        Case 801 To 810
            If rank = 810 Then
                HandName = "장땡"
            Else
                HandName = (rank - 800) & "땡"
            End If
        Case 750: HandName = "알리"
        Case 740: HandName = "독사"
        Case 730: HandName = "구삥"
        Case 720: HandName = "장삥"
        Case 710: HandName = "장사"
        Case 700: HandName = "세륙"
        Case 109: HandName = "갑오"
        Case 100: HandName = "망통"
        Case Else: HandName = (rank - 100) & "끗"
    End Select
End Function

' ===== v2 특수 패 판정 =====
' 땡잡이: 3월+7월 조합 → 1땡~9땡을 잡는다 (장땡·광땡은 못 잡음)
Public Function IsDdaengJabi(c1 As Integer, c2 As Integer) As Boolean
    Dim m1 As Integer, m2 As Integer
    m1 = modDeck.MonthOf(c1): m2 = modDeck.MonthOf(c2)
    IsDdaengJabi = (m1 = 3 And m2 = 7) Or (m1 = 7 And m2 = 3)
End Function

' 암행어사: 4월 열끗(41)+7월 열끗(71) → 13·18광땡을 잡는다 (38광땡은 못 잡음)
Public Function IsAmhaeng(c1 As Integer, c2 As Integer) As Boolean
    IsAmhaeng = (c1 = 41 And c2 = 71) Or (c1 = 71 And c2 = 41)
End Function

' 구사: 4월+9월 조합 → 최고 족보가 알리 이하면 재경기
Public Function IsGusa(c1 As Integer, c2 As Integer) As Boolean
    Dim m1 As Integer, m2 As Integer
    m1 = modDeck.MonthOf(c1): m2 = modDeck.MonthOf(c2)
    IsGusa = (m1 = 4 And m2 = 9) Or (m1 = 9 And m2 = 4)
End Function

' 멍텅구리구사: 4월 열끗(41)+9월 열끗(91) → 최고 족보가 장땡 이하면 재경기
Public Function IsMongGusa(c1 As Integer, c2 As Integer) As Boolean
    IsMongGusa = (c1 = 41 And c2 = 91) Or (c1 = 91 And c2 = 41)
End Function

' 표시용 라벨: 기본 족보명 + 특수 패 표기
Public Function HandLabel(c1 As Integer, c2 As Integer) As String
    Dim base As String
    base = HandName(HandRank(c1, c2))
    If IsAmhaeng(c1, c2) Then
        HandLabel = base & "·암행어사"
    ElseIf IsDdaengJabi(c1, c2) Then
        HandLabel = base & "·땡잡이"
    ElseIf IsMongGusa(c1, c2) Then
        HandLabel = base & "·멍구사"
    ElseIf IsGusa(c1, c2) Then
        HandLabel = base & "·구사"
    Else
        HandLabel = base
    End If
End Function

' 핸드 강도 0~1 정규화 (AI 판단용)
Public Function Strength(rank As Integer) As Double
    Select Case rank
        Case 1000: Strength = 1#
        Case 910, 905: Strength = 0.97
        Case 800 To 810: Strength = 0.78 + (rank - 800) * 0.017
        Case 700 To 750: Strength = 0.62 + (rank - 700) * 0.002
        Case Else: Strength = 0.05 + (rank - 100) * 0.06
    End Select
End Function
