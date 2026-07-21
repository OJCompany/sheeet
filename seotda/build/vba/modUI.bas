Option Explicit

#If VBA7 Then
Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal ms As Long)
#Else
Private Declare Sub Sleep Lib "kernel32" (ByVal ms As Long)
#End If

Public gFast As Boolean               ' 테스트용 고속 모드 (애니메이션/대기 생략)

Private Const P_CARD_W As Single = 90
Private Const AI_CARD_W As Single = 70
Private Const AI_CARD_H As Single = 100

Private Function GS() As Worksheet
    Set GS = ThisWorkbook.Worksheets("Game")
End Function

Private Function TitleShapeNames() As Variant
    TitleShapeNames = Array("title_bg", "title_name", "title_sub", "title_cnt_lbl", _
        "btn_Cnt2", "btn_Cnt3", "btn_Cnt4", "btn_Cnt5", _
        "btn_Easy", "btn_Normal", "btn_Hard", "title_stats")
End Function

Public Function SeatName(seat As Integer) As String
    If seat = 0 Then
        SeatName = "플레이어"
    Else
        SeatName = "AI " & seat
    End If
End Function

Public Function CardShapeName(seat As Integer, c As Integer) As String
    If seat = 0 Then
        CardShapeName = "card_P" & c
    Else
        CardShapeName = "ai" & seat & "_c" & c
    End If
End Function

Public Sub Pause(ms As Double)
    If gFast Then Exit Sub
    Dim t As Single
    t = Timer
    Do While Timer < t + ms / 1000
        DoEvents
        Sleep 5
        If Timer < t - 1 Then Exit Do   ' 자정 넘김 보호
    Loop
End Sub

' ===== 화면 전환 =====
Public Sub ShowTitleScreen()
    Dim n As Variant
    EnableButtons False
    HideNextButton
    For Each n In TitleShapeNames()
        GS.Shapes(n).Visible = True
        GS.Shapes(n).ZOrder msoBringToFront
    Next n
    HighlightCount
    On Error Resume Next
    GS.Shapes("title_stats").TextFrame2.TextRange.Text = _
        "전적 " & modSave.GetWins() & "승 " & modSave.GetLosses() & "패    보유 " & Format(gMoney(0), "#,0") & "P"
End Sub

Public Sub ShowGameScreen()
    Dim n As Variant
    For Each n In TitleShapeNames()
        GS.Shapes(n).Visible = False
    Next n
    LayoutSeats
End Sub

Public Sub HighlightCount()
    Dim i As Integer
    On Error Resume Next
    For i = 2 To 5
        With GS.Shapes("btn_Cnt" & i)
            If i = gSelCount Then
                .Line.Weight = 3
                .Line.ForeColor.RGB = RGB(240, 200, 90)
            Else
                .Line.Weight = 1.25
                .Line.ForeColor.RGB = RGB(40, 60, 90)
            End If
        End With
    Next i
End Sub

' AI 좌석 배치: 참가 인원에 맞춰 상단에 균등 배열
Public Sub LayoutSeats()
    Dim n As Integer, i As Integer, cx As Single
    n = gNumPlayers - 1
    For i = 1 To 4
        If i <= n Then
            ' 우측 족보 패널을 피해 중심 465, 간격 200으로 배치
            cx = 465 + (i - (n + 1) / 2) * 200
            With GS.Shapes("ai" & i & "_name")
                .Left = cx - 85: .Top = 16: .Visible = True
            End With
            With GS.Shapes("ai" & i & "_money")
                .Left = cx - 85: .Top = 40: .Visible = True
            End With
            With GS.Shapes("ai" & i & "_c1")
                .Left = cx - 76: .Top = 64
                .Width = AI_CARD_W: .Height = AI_CARD_H
                .Visible = False
            End With
            With GS.Shapes("ai" & i & "_c2")
                .Left = cx + 6: .Top = 64
                .Width = AI_CARD_W: .Height = AI_CARD_H
                .Visible = False
            End With
            With GS.Shapes("ai" & i & "_hand")
                .Left = cx - 85: .Top = 168: .Visible = False
            End With
        Else
            GS.Shapes("ai" & i & "_name").Visible = False
            GS.Shapes("ai" & i & "_money").Visible = False
            GS.Shapes("ai" & i & "_c1").Visible = False
            GS.Shapes("ai" & i & "_c2").Visible = False
            GS.Shapes("ai" & i & "_hand").Visible = False
        End If
    Next i
End Sub

Public Sub PrepareRound()
    Dim i As Integer
    GS.Shapes("lbl_PHand").Visible = False
    GS.Shapes("card_P1").Visible = False
    GS.Shapes("card_P2").Visible = False
    For i = 1 To 4
        GS.Shapes("ai" & i & "_c1").Visible = False
        GS.Shapes("ai" & i & "_c2").Visible = False
        GS.Shapes("ai" & i & "_hand").Visible = False
    Next i
    HideNextButton
End Sub

' ===== 버튼/라벨 =====
Public Sub EnableButtons(b As Boolean)
    GS.Shapes("btn_Call").Visible = b
    GS.Shapes("btn_Half").Visible = b
    GS.Shapes("btn_Die").Visible = b
    ' 따당은 직전 레이즈가 있을 때만
    GS.Shapes("btn_Ddadang").Visible = b And modBetting.CanDdadang(0)
End Sub

Public Sub ShowNextButton(caption As String)
    With GS.Shapes("btn_Next")
        .TextFrame2.TextRange.Text = caption
        .Visible = True
        .ZOrder msoBringToFront
    End With
End Sub

Public Sub HideNextButton()
    GS.Shapes("btn_Next").Visible = False
End Sub

Public Sub SetMessage(s As String)
    GS.Shapes("lbl_Msg").TextFrame2.TextRange.Text = s
    DoEvents
End Sub

Public Sub UpdateLabels()
    Dim i As Integer, txt As String
    GS.Shapes("lbl_Pot").TextFrame2.TextRange.Text = "판돈  " & Format(gPot, "#,0") & "P"
    GS.Shapes("lbl_PMoney").TextFrame2.TextRange.Text = "자금  " & Format(gMoney(0), "#,0") & "P"
    GS.Shapes("lbl_Record").TextFrame2.TextRange.Text = "전적  " & modSave.GetWins() & "승 " & modSave.GetLosses() & "패"
    For i = 1 To gNumPlayers - 1
        txt = "자금  " & Format(gMoney(i), "#,0") & "P"
        If gOut(i) Then txt = "탈락"
        GS.Shapes("ai" & i & "_money").TextFrame2.TextRange.Text = txt
    Next i
End Sub

' ===== 카드 이미지 (cards 폴더, 없으면 도형 디자인으로 대체) =====
Private Function CardImagePath(card As Integer) As String
    On Error Resume Next
    Dim p As String
    p = ThisWorkbook.Path & "\cards\" & card & ".png"
    If Dir(p) <> "" Then CardImagePath = p
End Function

Private Function BackImagePath() As String
    On Error Resume Next
    Dim p As String
    p = ThisWorkbook.Path & "\cards\back.png"
    If Dir(p) <> "" Then BackImagePath = p
End Function

' 덱 더미에 뒷면 이미지 적용 (앱 시작 시 호출)
Public Sub InitDeckPile()
    On Error Resume Next
    RenderCard "deck_Pile", 0, False
End Sub

' ===== 카드 렌더링 =====
Public Sub RenderCard(nm As String, card As Integer, faceUp As Boolean)
    Dim sh As Shape
    Set sh = GS.Shapes(nm)
    Dim tr As TextRange2
    Set tr = sh.TextFrame2.TextRange

    ' 이미지가 있으면 그림으로 렌더
    Dim p As String
    If faceUp Then
        p = CardImagePath(card)
    Else
        p = BackImagePath()
    End If
    If p <> "" Then
        On Error Resume Next
        Err.Clear
        sh.Fill.UserPicture p
        If Err.Number = 0 Then
            tr.Text = ""
            sh.Line.Visible = msoTrue
            sh.Line.Weight = 1
            sh.Line.ForeColor.RGB = RGB(40, 40, 40)
            Exit Sub
        End If
        Err.Clear
        On Error GoTo 0
    End If

    ' 이미지가 없으면 도형 디자인
    Dim small As Boolean
    small = (sh.Width < 80 And sh.Width > 10) Or (nm Like "ai*")
    sh.Line.Weight = 1.5
    sh.Line.Visible = msoTrue
    If Not faceUp Then
        sh.Fill.ForeColor.RGB = RGB(150, 34, 34)
        sh.Line.ForeColor.RGB = RGB(90, 16, 16)
        tr.Text = "花" & vbLf & "鬪"
        tr.Font.Fill.ForeColor.RGB = RGB(230, 195, 120)
        tr.Font.Size = IIf(small, 15, 22)
        tr.Font.Bold = msoTrue
    Else
        Dim m As Integer
        m = modDeck.MonthOf(card)
        Dim nmArr As Variant
        nmArr = Array("", "송학", "매조", "벚꽃", "흑싸리", "난초", "모란", "홍싸리", "공산", "국화", "단풍")
        sh.Fill.ForeColor.RGB = RGB(250, 247, 238)
        sh.Line.ForeColor.RGB = RGB(70, 70, 70)
        If modDeck.IsGwang(card) Then
            tr.Text = m & vbLf & nmArr(m) & vbLf & "光"
            tr.Font.Fill.ForeColor.RGB = RGB(190, 30, 30)
        Else
            tr.Text = m & vbLf & nmArr(m)
            tr.Font.Fill.ForeColor.RGB = RGB(35, 35, 35)
        End If
        tr.Font.Size = IIf(small, 13, 20)
        tr.Font.Bold = msoTrue
    End If
End Sub

' 다이한 좌석의 카드를 어둡게 (이미지 카드도 회색 단색으로 덮음)
Public Sub ShowFold(seat As Integer)
    Dim c As Integer
    On Error Resume Next
    For c = 1 To 2
        With GS.Shapes(CardShapeName(seat, c))
            .Fill.Solid
            .Fill.ForeColor.RGB = RGB(70, 70, 70)
            .Line.ForeColor.RGB = RGB(50, 50, 50)
            .TextFrame2.TextRange.Text = "다이"
            .TextFrame2.TextRange.Font.Size = 12
            .TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(140, 140, 140)
        End With
    Next c
End Sub

Private Sub MoveShape(sh As Shape, x2 As Single, y2 As Single, steps As Integer)
    Dim x1 As Single, y1 As Single, i As Integer
    x1 = sh.Left: y1 = sh.Top
    For i = 1 To steps
        sh.Left = x1 + (x2 - x1) * i / steps
        sh.Top = y1 + (y2 - y1) * i / steps
        DoEvents
        If Not gFast Then Sleep 8
    Next i
End Sub

Private Sub FlipCard(nm As String, card As Integer)
    Dim sh As Shape
    Set sh = GS.Shapes(nm)
    Dim w0 As Single, cx As Single, i As Integer
    w0 = sh.Width
    cx = sh.Left + w0 / 2
    If Not gFast Then
        For i = 1 To 6
            sh.Width = w0 * (6 - i) / 6 + 2
            sh.Left = cx - sh.Width / 2
            DoEvents
            Sleep 12
        Next i
    End If
    RenderCard nm, card, True
    If Not gFast Then
        For i = 1 To 6
            sh.Width = w0 * i / 6 + 2
            sh.Left = cx - sh.Width / 2
            DoEvents
            Sleep 12
        Next i
    End If
    sh.Width = w0
    sh.Left = cx - w0 / 2
End Sub

' ===== 연출 =====
Public Sub DealAnimation()
    Dim names(0 To 9) As String
    Dim fx(0 To 9) As Single, fy(0 To 9) As Single
    Dim cnt As Integer, c As Integer, i As Integer
    cnt = 0
    For c = 1 To 2
        For i = 0 To gNumPlayers - 1
            If Not gFolded(i) Then
                names(cnt) = CardShapeName(i, c)
                cnt = cnt + 1
            End If
        Next i
    Next c
    Dim sh As Shape
    For i = 0 To cnt - 1
        Set sh = GS.Shapes(names(i))
        fx(i) = sh.Left
        fy(i) = sh.Top
        RenderCard names(i), 0, False
        sh.Left = GS.Shapes("deck_Pile").Left
        sh.Top = GS.Shapes("deck_Pile").Top
        sh.Visible = True
        sh.ZOrder msoBringToFront
    Next i
    For i = 0 To cnt - 1
        modSound.PlayCard
        MoveShape GS.Shapes(names(i)), fx(i), fy(i), IIf(gFast, 2, 10)
    Next i
    ' 내 패만 공개
    FlipCard "card_P1", gCards(0, 1)
    FlipCard "card_P2", gCards(0, 2)
End Sub

Public Sub RevealSeat(seat As Integer)
    modSound.PlayCard
    FlipCard CardShapeName(seat, 1), gCards(seat, 1)
    FlipCard CardShapeName(seat, 2), gCards(seat, 2)
End Sub

Public Sub ShowPlayerHandName()
    With GS.Shapes("lbl_PHand")
        .TextFrame2.TextRange.Text = modHand.HandLabel(gCards(0, 1), gCards(0, 2))
        .Visible = True
    End With
End Sub

Public Sub ShowHandNames()
    Dim i As Integer
    ShowPlayerHandName
    For i = 1 To gNumPlayers - 1
        If Not gFolded(i) Then
            With GS.Shapes("ai" & i & "_hand")
                .TextFrame2.TextRange.Text = modHand.HandLabel(gCards(i, 1), gCards(i, 2))
                .Visible = True
            End With
        End If
    Next i
End Sub
