; Inno Setup script producing EasyGestAdmin_Setup.exe.
;
; Compile from the repository root, after PyInstaller has produced
; dist\EasyGestAdmin.exe:
;
;   iscc /DAppVersion=2.5.0 packaging\EasyGestAdmin.iss
;
; This is the software owner's application: it runs the central server and
; shows the Global Administrator console. Its database lives in
; %PROGRAMDATA%\EasyGest\central and is never touched by the installer, so the
; clients, licences and plans survive updates and reinstalls.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "EasyGest Admin"
#define AppExe "EasyGestAdmin.exe"

[Setup]
AppId={{8F1B2A5E-6D3C-4C9A-9E0D-EASYGEST0002}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=EasyGest
DefaultDirName={autopf}\EasyGest Admin
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir=..\dist
OutputBaseFilename=EasyGestAdmin_Setup
SetupIconFile=EasyGest.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; \
  GroupDescription: "Raccourcis :"

[Dirs]
Name: "{commonappdata}\EasyGest\central"; Permissions: users-modify

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; \
  Flags: deleteafterinstall skipifsourcedoesntexist

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; \
  Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installation du composant d'affichage..."; \
  Check: NeedsWebView2; Flags: waituntilterminated skipifdoesntexist
; The shops synchronise their licence with this computer on port 8600, so the
; private-network firewall is opened once at install time.
Filename: "{cmd}"; Parameters: "/c netsh advfirewall firewall add rule \
  name=""EasyGest Admin"" dir=in action=allow protocol=TCP localport=8600 \
  profile=private"; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "Lancer {#AppName}"; \
  Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function NeedsWebView2: Boolean;
var
  Version: String;
begin
  Result := not (
    RegQueryStringValue(HKLM,
      'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' +
      '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\' +
      '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\' +
      '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    ForceDirectories(ExpandConstant('{commonappdata}\EasyGest\central'));
end;
