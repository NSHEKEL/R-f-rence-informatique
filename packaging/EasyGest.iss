; Inno Setup script producing EasyGest_Setup.exe.
;
; Compile from the repository root, after PyInstaller has produced
; dist\EasyGest.exe:
;
;   iscc /DAppVersion=2.0.0 packaging\EasyGest.iss
;
; The user data (database, backups, settings) lives in %PROGRAMDATA%\EasyGest,
; shared by every Windows account of the computer, and is never touched by the
; installer or the uninstaller, so updating or reinstalling keeps every sale
; and the company settings.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "EasyGest"
#ifndef AppExe
  #define AppExe "EasyGest.exe"
#endif

[Setup]
AppId={{8F1B2A5E-6D3C-4C9A-9E0D-EASYGEST0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=EasyGest
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
OutputDir=..\dist
#ifdef Arch32
OutputBaseFilename=EasyGest_Setup_x86
#else
OutputBaseFilename=EasyGest_Setup
#endif
SetupIconFile=EasyGest.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
#ifndef Arch32
ArchitecturesInstallIn64BitMode=x64compatible
#endif
CloseApplications=yes
RestartApplications=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; \
  GroupDescription: "Raccourcis :"

[Dirs]
; Shared data folder: every account (and the program started without
; administrator rights) must be able to write the database into it.
Name: "{commonappdata}\{#AppName}"; Permissions: users-modify

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; \
  Flags: deleteafterinstall skipifsourcedoesntexist
; Kept next to the exe so the launcher can repair a missing WebView2 runtime
; by itself (poste sans Internet, installation interrompue, runtime désinstallé).
Source: "MicrosoftEdgeWebview2Setup.exe"; DestDir: "{app}"; \
  Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; \
  Tasks: desktopicon

[Run]
; The window needs the Edge WebView2 runtime; it ships with Windows 11 and
; recent Windows 10, and is installed silently when missing.
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installation du composant d'affichage..."; \
  Check: NeedsWebView2; Flags: waituntilterminated skipifdoesntexist
; The other workstations and the Android application reach this computer on
; port 8000, so the private-network firewall is opened once at install time.
Filename: "{cmd}"; Parameters: "/c netsh advfirewall firewall add rule \
  name=""EasyGest"" dir=in action=allow protocol=TCP localport=8000 \
  profile=private"; Flags: runhidden waituntilterminated
; runasoriginaluser: started as the shop's account, not as the administrator
; who ran the installer, so the application keeps using the same data folder.
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
    ForceDirectories(ExpandConstant('{commonappdata}\EasyGest'));
end;
