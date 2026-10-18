; Превью проектов .kras в проводнике Windows.
; Файл .kras — это обычный PNG с проектом внутри, поэтому ему подходит встроенный
; обработчик миниатюр Windows для картинок (Photo Thumbnail Provider).
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\.kras\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" "" "{C7657C4A-9F68-40fa-A4DF-96BC08EB3551}"
  WriteRegStr SHCTX "Software\Classes\.kras" "PerceivedType" "image"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\.kras\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
  DeleteRegValue SHCTX "Software\Classes\.kras" "PerceivedType"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
