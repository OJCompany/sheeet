Option Explicit

' 카드 인코딩: 월*10 + 순번(1,2). 광은 11(1월), 31(3월), 81(8월)
Private mDeck(1 To 20) As Integer
Private mPos As Integer

Public Sub ShuffleDeck()
    Dim i As Integer, j As Integer, t As Integer
    For i = 1 To 20
        mDeck(i) = ((i + 1) \ 2) * 10 + ((i - 1) Mod 2) + 1
    Next i
    ' Fisher-Yates 셔플
    For i = 20 To 2 Step -1
        j = Int(Rnd() * i) + 1
        t = mDeck(i): mDeck(i) = mDeck(j): mDeck(j) = t
    Next i
    mPos = 0
End Sub

Public Function Draw() As Integer
    mPos = mPos + 1
    Draw = mDeck(mPos)
End Function

Public Function MonthOf(card As Integer) As Integer
    MonthOf = card \ 10
End Function

Public Function IsGwang(card As Integer) As Boolean
    IsGwang = (card = 11 Or card = 31 Or card = 81)
End Function
