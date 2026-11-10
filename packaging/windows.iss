#ifndef AppVersion
  #define AppVersion "0.2.1"
#endif
#ifndef OutputName
  #define OutputName "RD-TAM-windows-setup"
#endif

[Setup]
AppId={{BF0CB042-38A0-4A49-B57D-FE0438443FDD}
AppName=RD-TAM
AppVersion={#AppVersion}
AppPublisher=RD
DefaultDirName={localappdata}\Programs\RD-TAM
DefaultGroupName=RD-TAM
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename={#OutputName}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\RD-TAM.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; Flags: unchecked

[Files]
Source: "..\dist\RD-TAM\*"; DestDir: "{app}"; Excludes: "portable.flag,data\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\RD-TAM"; Filename: "{app}\RD-TAM.exe"; IconFilename: "{app}\RD-TAM.exe"
Name: "{autodesktop}\RD-TAM"; Filename: "{app}\RD-TAM.exe"; IconFilename: "{app}\RD-TAM.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\RD-TAM.exe"; Description: "Abrir RD-TAM"; Flags: nowait postinstall skipifsilent
