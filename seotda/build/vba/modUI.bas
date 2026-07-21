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
    TitleShapeNames = Array("title_bg", _
        "btn_Cnt2", "btn_Cnt3", "btn_Cnt4", "btn_Cnt5", _
        "btn_Easy", "btn_Normal", "btn_Hard", "btn_Start", "title_stats")
End Function

Public Function SeatName(seat As Integer) As String
    Select Case seat
        Case 0: SeatName = "플레이어"
        Case 1: SeatName = "고오니"
        Case 2: SeatName = "악귀"
        Case 3: SeatName = "고과앙렬"
        Case 4: SeatName = "정마음담"
        Case Else: SeatName = "AI " & seat
    End Select
End Function

Public Function CardShapeName(seat As Integer, c As Integer) As String
    If seat = 0 Then
        CardShapeName = "card_P" & c
    Else
        CardShapeName = "ai" & seat & "_c" & c
    End If
End Function

' 텍스트 교체 시 서식이 초기화되는 문제를 막기 위해 폰트를 함께 재적용
Private Sub SetText(nm As String, s As String, sz As Single, col As Long, Optional align As Integer = 0)
    On Error Resume Next
    With GS.Shapes(nm).TextFrame2.TextRange
        .Text = s
        .Font.Name = "Jua"
        .Font.NameFarEast = "Jua"
        .Font.Size = sz
        .Font.Fill.ForeColor.RGB = col
        If align > 0 Then .ParagraphFormat.Alignment = align
    End With
End Sub

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
    RenderTitleBg
    For Each n In TitleShapeNames()
        GS.Shapes(n).Visible = True
        GS.Shapes(n).ZOrder msoBringToFront
    Next n
    HighlightCount
    HighlightDiff
    SetText "title_stats", "전적 " & modSave.GetWins() & "승 " & modSave.GetLosses() & "패    보유 " & Format(gMoney(0), "#,0") & "P", 15, RGB(245, 233, 200)
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
            .Fill.Solid
            If i = gSelCount Then
                ' 선택됨: 크림 바탕 + 진홍 글자 + 금테
                .Fill.ForeColor.RGB = RGB(245, 233, 200)
                .Line.Visible = msoTrue
                .Line.Weight = 2.5
                .Line.ForeColor.RGB = RGB(240, 200, 90)
                .TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(150, 34, 34)
            Else
                ' 기본: 진홍 바탕 + 크림 글자, 테두리 없음
                .Fill.ForeColor.RGB = RGB(168, 42, 38)
                .Line.Visible = msoFalse
                .TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(245, 233, 200)
            End If
        End With
    Next i
End Sub

' 난이도 선택 표시 (인원수와 동일한 선택 스타일)
Public Sub HighlightDiff()
    Dim i As Integer
    Dim names As Variant
    names = Array("", "btn_Easy", "btn_Normal", "btn_Hard")
    On Error Resume Next
    For i = 1 To 3
        With GS.Shapes(names(i))
            .Fill.Solid
            If i = gDifficulty Then
                ' 선택됨: 크림 바탕 + 진홍 글자 + 금테
                .Fill.ForeColor.RGB = RGB(245, 233, 200)
                .Line.Visible = msoTrue
                .Line.Weight = 2.5
                .Line.ForeColor.RGB = RGB(240, 200, 90)
                .TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(150, 34, 34)
            Else
                ' 기본: 난이도별 색 바탕 + 크림 글자, 테두리 없음
                Select Case i
                    Case 1: .Fill.ForeColor.RGB = RGB(58, 122, 74)
                    Case 2: .Fill.ForeColor.RGB = RGB(196, 130, 42)
                    Case 3: .Fill.ForeColor.RGB = RGB(168, 42, 38)
                End Select
                .Line.Visible = msoFalse
                .TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(245, 233, 200)
            End If
        End With
    Next i
End Sub

' AI 좌석 배치: 좌우 가장자리에 배치 (한게임 스타일)
'  슬롯 순서: 1 좌상 → 2 우상 → 3 좌하 → 4 우하
'  좌측: [아바타/이름/자금] + 오른쪽에 카드 2장 / 우측: 카드 2장 + [아바타/이름/자금]
Public Sub LayoutSeats()
    Dim n As Integer, i As Integer
    n = gNumPlayers - 1
    Dim ys As Variant, rs As Variant
    ys = Array(0, 22, 22, 152, 152)                    ' 슬롯별 세로 위치
    rs = Array(False, False, True, False, True)        ' 슬롯별 우측 여부
    For i = 1 To 4
        If i <= n Then
            Dim y As Single, rgt As Boolean
            Dim ax As Single, nx As Single, c1x As Single, c2x As Single, hx As Single
            y = ys(i)
            rgt = rs(i)
            If rgt Then
                c1x = 645: c2x = 720: ax = 798: nx = 782: hx = 645
            Else
                ax = 16: nx = 2: c1x = 78: c2x = 153: hx = 78
            End If
            With GS.Shapes("ai" & i & "_avatar")
                .Left = ax: .Top = y + 4
                .Width = 44: .Height = 44
                .Visible = True
            End With
            RenderAvatar i
            With GS.Shapes("ai" & i & "_name")
                .Left = nx: .Top = y + 50: .Width = 74: .Visible = True
            End With
            SetText "ai" & i & "_name", SeatName(i), 10, RGB(245, 245, 245), 2
            With GS.Shapes("ai" & i & "_money")
                .Left = nx: .Top = y + 66: .Width = 74: .Visible = True
            End With
            With GS.Shapes("ai" & i & "_c1")
                .Left = c1x: .Top = y + 4
                .Width = AI_CARD_W: .Height = AI_CARD_H
                .Visible = False
            End With
            With GS.Shapes("ai" & i & "_c2")
                .Left = c2x: .Top = y + 4
                .Width = AI_CARD_W: .Height = AI_CARD_H
                .Visible = False
            End With
            With GS.Shapes("ai" & i & "_hand")
                .Left = hx: .Top = y + 106: .Width = 145: .Visible = False
            End With
        Else
            GS.Shapes("ai" & i & "_avatar").Visible = False
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
    GS.Shapes("deck_Pile").Visible = False
    GS.Shapes("coin_fly").Visible = False
    UpdatePotPile
    HideNextButton
End Sub

' 베팅 금액이 중앙 판돈으로 날아가는 연출
Public Sub ThrowMoney(seat As Integer)
    If gFast Then Exit Sub
    On Error Resume Next
    Dim sh As Shape
    Set sh = GS.Shapes("coin_fly")
    Dim x0 As Single, y0 As Single
    If seat = 0 Then
        x0 = 84: y0 = 448
    Else
        x0 = GS.Shapes("ai" & seat & "_avatar").Left + 10
        y0 = GS.Shapes("ai" & seat & "_avatar").Top + 10
    End If
    sh.Left = x0
    sh.Top = y0
    sh.Visible = True
    sh.ZOrder msoBringToFront
    MoveShape sh, 417, 120, 8
    sh.Visible = False
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
    SetText "btn_Next", caption, 14, RGB(245, 245, 245)
    With GS.Shapes("btn_Next")
        .Visible = True
        .ZOrder msoBringToFront
    End With
End Sub

Public Sub HideNextButton()
    GS.Shapes("btn_Next").Visible = False
End Sub

Public Sub SetMessage(s As String)
    SetText "lbl_Msg", s, 13, RGB(245, 245, 245)
    DoEvents
End Sub

' 판돈 규모에 따라 중앙 돈더미 표시 (동전 → 지폐뭉치)
Public Sub UpdatePotPile()
    On Error Resume Next
    Dim bills As Integer, coins As Integer
    If gPot <= 0 Then
        bills = 0: coins = 0
    ElseIf gPot < 1000 Then
        bills = 0: coins = 2
    ElseIf gPot < 5000 Then
        bills = 1: coins = 3
    ElseIf gPot < 20000 Then
        bills = 2: coins = 2
    Else
        bills = 3: coins = 3
    End If
    Dim i As Integer
    For i = 1 To 3
        GS.Shapes("pile_b" & i).Visible = (i <= bills)
        GS.Shapes("pile_c" & i).Visible = (i <= coins)
    Next i
End Sub

Public Sub UpdateLabels()
    Dim i As Integer, txt As String
    SetText "lbl_Pot", "판돈  " & Format(gPot, "#,0") & "P", 16, RGB(240, 200, 90)
    UpdatePotPile
    SetText "lbl_PMoney", "자금  " & Format(gMoney(0), "#,0") & "P", 11, RGB(200, 205, 210)
    SetText "lbl_Record", "전적  " & modSave.GetWins() & "승 " & modSave.GetLosses() & "패", 11, RGB(200, 205, 210)
    For i = 1 To gNumPlayers - 1
        txt = Format(gMoney(i), "#,0") & "P"
        If gOut(i) Then txt = "탈락"
        SetText "ai" & i & "_money", txt, 10, RGB(200, 205, 210), 2
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

' ===== 배경 이미지 (bg 폴더, 없으면 기본 색상) =====
Private Function BgPath(base As String) As String
    On Error Resume Next
    Dim p As String
    p = ThisWorkbook.Path & "\bg\" & base & ".png"
    If Dir(p) <> "" Then BgPath = p: Exit Function
    p = ThisWorkbook.Path & "\bg\" & base & ".jpg"
    If Dir(p) <> "" Then BgPath = p
End Function

Public Sub RenderTitleBg()
    On Error Resume Next
    Dim sh As Shape
    Set sh = GS.Shapes("title_bg")
    Dim p As String
    p = BgPath("title")
    If p <> "" Then
        sh.Fill.UserPicture p
    Else
        sh.Fill.Solid
        sh.Fill.ForeColor.RGB = RGB(24, 28, 40)
    End If
End Sub

Public Sub RenderTableBg()
    On Error Resume Next
    Dim sh As Shape
    Set sh = GS.Shapes("bg_Table")
    Dim p As String
    p = BgPath("table")
    If p <> "" Then sh.Fill.UserPicture p
End Sub

' ===== 아바타 (avatars 폴더, 없으면 단색 원 + 첫 글자) =====
Private Function AvatarPath(seat As Integer) As String
    On Error Resume Next
    Dim f As String
    If seat = 0 Then f = "player.png" Else f = "ai" & seat & ".png"
    Dim p As String
    p = ThisWorkbook.Path & "\avatars\" & f
    If Dir(p) <> "" Then AvatarPath = p
End Function

Public Sub RenderAvatar(seat As Integer)
    Dim nm As String
    If seat = 0 Then nm = "player_avatar" Else nm = "ai" & seat & "_avatar"
    Dim sh As Shape
    On Error Resume Next
    Set sh = GS.Shapes(nm)
    On Error GoTo 0
    If sh Is Nothing Then Exit Sub

    Dim p As String
    p = AvatarPath(seat)
    If p <> "" Then
        On Error Resume Next
        Err.Clear
        sh.Fill.UserPicture p
        If Err.Number = 0 Then
            sh.TextFrame2.TextRange.Text = ""
            sh.Line.Visible = msoTrue
            sh.Line.Weight = 1.5
            sh.Line.ForeColor.RGB = RGB(240, 200, 90)
            Exit Sub
        End If
        Err.Clear
        On Error GoTo 0
    End If
    ' 폴백: 좌석별 단색 원 + 이름 첫 글자
    Dim cols As Variant
    cols = Array(RGB(60, 160, 140), RGB(190, 80, 80), RGB(140, 90, 190), RGB(220, 140, 50), RGB(70, 130, 180))
    sh.Fill.Solid
    sh.Fill.ForeColor.RGB = cols(seat)
    sh.Line.Visible = msoTrue
    sh.Line.Weight = 1.5
    sh.Line.ForeColor.RGB = RGB(240, 200, 90)
    With sh.TextFrame2.TextRange
        .Text = Left(SeatName(seat), 1)
        .Font.Name = "Jua"
        .Font.NameFarEast = "Jua"
        .Font.Size = 16
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = RGB(245, 245, 245)
    End With
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
        tr.Font.Name = "Jua"
        tr.Font.NameFarEast = "Jua"
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
        tr.Font.Name = "Jua"
        tr.Font.NameFarEast = "Jua"
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
            .TextFrame2.TextRange.Font.Name = "Jua"
            .TextFrame2.TextRange.Font.NameFarEast = "Jua"
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
    ' 덱은 배분하는 동안만 보여준다
    GS.Shapes("deck_Pile").Visible = True
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
    GS.Shapes("deck_Pile").Visible = False
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
    SetText "lbl_PHand", modHand.HandLabel(gCards(0, 1), gCards(0, 2)), 13, RGB(240, 200, 90)
    GS.Shapes("lbl_PHand").Visible = True
End Sub

Public Sub ShowHandNames()
    Dim i As Integer
    ShowPlayerHandName
    For i = 1 To gNumPlayers - 1
        If Not gFolded(i) Then
            SetText "ai" & i & "_hand", modHand.HandLabel(gCards(i, 1), gCards(i, 2)), 11, RGB(240, 200, 90), 2
            GS.Shapes("ai" & i & "_hand").Visible = True
        End If
    Next i
End Sub
