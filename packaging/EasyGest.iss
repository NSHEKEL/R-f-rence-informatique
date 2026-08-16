; Inno Setup script producing EasyGest_Setup.exe.
;
; Compile from the repository root, after PyInstaller has produced
; dist\EasyGest.exe:
;
;   iscc /DAppVersion=2.0.0 packaging\EasyGest.iss
;
; The user data (database, backups, settings) lives in %APPDATA%\EasyGest and
; is never touched by the installer or the uninstaller, so updating or
; reinstalling keeps every sale.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "EasyGest"
#define AppExe "EasyGest.exe"

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
OutputBaseFilename=EasyGest_Setup
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
Name: "serveur"; Description: \
  "Poste serveur : partager la base avec les autres ordinateurs du réseau"; \
  GroupDescription: "Réseau :"; Flags: unchecked

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
; The window needs the Edge WebView2 runtime; it ships with Windows 11 and
; recent Windows 10, and is installed silently when missing.
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installation du composant d'affichage..."; \
  Check: NeedsWebView2; Flags: waituntilterminated skipifdoesntexist
; Server workstation: listen on the network and open the Windows firewall.
Filename: "{cmd}"; Parameters: "/c netsh advfirewall firewall add rule \
  name=""EasyGest"" dir=in action=allow protocol=TCP localport=8000 \
  profile=private"; Tasks: serveur; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "Lancer {#AppName}"; \
  Flags: nowait postinstall skipifsilent

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
var
  DataDir: String;
  Lines: TArrayOfString;
begin
  if CurStep = ssPostInstall then
  begin
    DataDir := ExpandConstant('{userappdata}\EasyGest');
    ForceDirectories(DataDir);
    if WizardIsTaskSelected('serveur') then
    begin
      SetArrayLength(Lines, 2);
      Lines[0] := '# Poste serveur : les autres ordinateurs se connectent ' +
        'a http://<adresse-ip-de-ce-poste>:8000';
      Lines[1] := 'EASYGEST_HOST=0.0.0.0';
      SaveStringsToFile(DataDir + '\.env', Lines, True);
    end;
  end;
end;
