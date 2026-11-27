; インストーラーのフック（仕様書 5.13）。
; アプリの中からの更新は、インストーラーを起こすとアプリが先に終わるので、インストーラーが
; どこで止まったかをアプリから知る手立てがない。そこで、動き始めたときと最後まで終わったときに
; アプリのデータのフォルダの installer.log へ書き残し、次の起動でアプリが読んで診断を出す。
; 書けなくてもインストールは続ける（エラーの印は消しておく）

!macro NSIS_HOOK_PREINSTALL
  Push $0
  CreateDirectory "$APPDATA\app.otosazu"
  FileOpen $0 "$APPDATA\app.otosazu\installer.log" w
  FileWrite $0 "start ${VERSION}$\r$\n"
  FileClose $0
  ClearErrors
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  FileOpen $0 "$APPDATA\app.otosazu\installer.log" a
  FileSeek $0 0 END
  FileWrite $0 "done ${VERSION}$\r$\n"
  FileClose $0
  ClearErrors
  Pop $0
!macroend
