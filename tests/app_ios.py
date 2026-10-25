#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova da casca do iPhone (25/10; o passo a passo é o docs/APP_STORE.md).

    python tests/app_ios.py

Esta máquina não tem Mac: nada aqui compila. Cobra o que dá para cobrar sem o Xcode, para o projeto
`ios/` não chegar quebrado ao Mac ou à nuvem que vai compilar:
  - o @capacitor/ios é da MESMA versão do Capacitor do Android (o core e a parte nativa andam juntos);
  - o capacitor.config.json: o `allowNavigation` com o domínio do jogo e só ele (sem ele a entrada abre no
    Safari — o iOS só chama de "do aplicativo" o endereço que começa pelo `server.url` INTEIRO), e o
    `empacota_www.py` recusa a configuração sem ele;
  - todo plugin do package.json está no iPhone ou na lista do que fica de fora DE PROPÓSITO (o AdMob, até
    existirem o aviso de rastreamento e os identificadores da Google no Info.plist), e o Package.swift do
    Capacitor diz os mesmos plugins — sinal de que o `npx cap sync ios` rodou depois da última mudança;
  - o projeto: o identificador é o do Android, só iPhone, a versão, o manifesto de privacidade DENTRO do app
    e todo objeto citado no project.pbxproj existe (ele é editado à mão);
  - o Info.plist: só deitado, sem barra de status, os três idiomas, o aviso de criptografia, a frase da Fotos
    (o compartilhar oferece "Salvar imagem", e sem a frase o iOS fecha o aplicativo);
  - o ícone sem transparência (a App Store recusa) e a abertura;
  - o que é gerado fica fora do Git, o projeto entra, e o servidor não leva a pasta;
  - a receita da nuvem (codemagic.yaml): o mesmo identificador, os mesmos passos de casa (a www/, o
    `npx cap sync ios`, esta prova) e nenhum segredo dentro dela.
"""
import json
import os
import plistlib
import re
import struct
import subprocess
import sys
import zlib

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(RAIZ, 'tools'))
sys.dont_write_bytecode = True
import empacota_www  # noqa: E402
import sobe_vps  # noqa: E402

IOS = os.path.join(RAIZ, 'ios')
APP = os.path.join(IOS, 'App', 'App')
PBXPROJ = os.path.join(IOS, 'App', 'App.xcodeproj', 'project.pbxproj')

# Os plugins que ficam FORA do iPhone de propósito, e por quê. Plugin novo no package.json tem de entrar no
# ios.includePlugins do capacitor.config.json ou nesta lista — senão o iPhone ficaria sem ele em silêncio.
FORA_DO_IOS = {
    '@capacitor-community/admob': 'o anúncio premiado no iPhone pede o aviso de rastreamento (ATT), o id do '
                                  'aplicativo no AdMob e os identificadores SKAdNetwork no Info.plist '
                                  '(docs/APP_STORE.md, "O anúncio premiado no iPhone")',
}
# O que não é plugin: o próprio Capacitor
NAO_PLUGIN = {'@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli'}

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + str(extra)) if extra and not ok else ''))


def ler(*partes):
    with open(os.path.join(RAIZ, *partes), 'rb') as f:
        return f.read().decode('utf-8')


def plist(*partes):
    with open(os.path.join(RAIZ, *partes), 'rb') as f:
        return plistlib.load(f)


def git(*args):
    return subprocess.run(['git', '-C', RAIZ] + list(args), capture_output=True, text=True, encoding='utf-8')


def png(caminho):
    """(largura, altura, tipo de cor) do cabeçalho de um PNG. Tipo 2 = RGB, 6 = RGBA (com transparência)."""
    with open(caminho, 'rb') as f:
        cab = f.read(26)
    if cab[:8] != b'\x89PNG\r\n\x1a\n' or cab[12:16] != b'IHDR':
        return None
    larg, alt = struct.unpack('>II', cab[16:24])
    return larg, alt, cab[25]


def png_canto(caminho):
    """A cor (r, g, b) do pixel do canto de cima à esquerda de um PNG RGB de 8 bits. Na primeira linha todo
    filtro do PNG deixa o primeiro pixel como veio (não há vizinho à esquerda nem em cima)."""
    with open(caminho, 'rb') as f:
        bruto = f.read()
    i, dados = 8, b''
    while i < len(bruto):
        n, tipo = struct.unpack('>I4s', bruto[i:i + 8])
        if tipo == b'IDAT':
            dados += bruto[i + 8:i + 8 + n]
        i += 12 + n
    linha = zlib.decompressobj().decompress(dados, 8)
    return tuple(linha[1:4])


def dependencias():
    pk = json.loads(ler('package.json'))
    lock = json.loads(ler('package-lock.json'))
    deps = dict(pk.get('dependencies') or {})
    resolvida = lambda n: ((lock.get('packages') or {}).get('node_modules/' + n) or {}).get('version')
    check('o @capacitor/ios está no package.json com a mesma faixa do core e do android',
          deps.get('@capacitor/ios') and deps.get('@capacitor/ios') == deps.get('@capacitor/core') == deps.get('@capacitor/android'),
          '%s / %s / %s' % (deps.get('@capacitor/ios'), deps.get('@capacitor/core'), deps.get('@capacitor/android')))
    v = {n: resolvida(n) for n in ('@capacitor/ios', '@capacitor/core', '@capacitor/android', '@capacitor/cli')}
    check('o package-lock.json resolve o ios, o core, o android e o cli na MESMA versão',
          v['@capacitor/ios'] and len(set(v.values())) == 1, v)
    return deps, v['@capacitor/ios']


def configuracao(deps):
    cfg = json.loads(ler('capacitor.config.json'))
    srv = cfg.get('server') or {}
    host = empacota_www.SERVIDOR.split('://', 1)[1]
    check('server.allowNavigation é o domínio do jogo e só ele (o iPhone abre a entrada dentro do aplicativo)',
          srv.get('allowNavigation') == [host], srv.get('allowNavigation'))
    check('o empacota_www.py aceita a configuração de hoje',
          empacota_www.problemas_da_config(srv, empacota_www.SERVIDOR) == [],
          empacota_www.problemas_da_config(srv, empacota_www.SERVIDOR))
    sem = dict(srv)
    sem.pop('allowNavigation', None)
    fora = dict(srv, allowNavigation=[host, 'outro.exemplo'])
    check('o empacota_www.py recusa a configuração sem o allowNavigation, e com um domínio de fora',
          any('allowNavigation' in e for e in empacota_www.problemas_da_config(sem, empacota_www.SERVIDOR)) and
          any('allowNavigation' in e for e in empacota_www.problemas_da_config(fora, empacota_www.SERVIDOR)))
    ios = cfg.get('ios') or {}
    check('ios.contentInset "never": o jogo cuida da área segura (viewport-fit=cover e env(safe-area-inset-*))',
          ios.get('contentInset') == 'never' and 'viewport-fit=cover' in ler('index.html') and
          'env(safe-area-inset-left' in ler('css', 'style.css'), ios.get('contentInset'))
    check('o fundo do WebView do iPhone é o preto do jogo, como no Android',
          ios.get('backgroundColor') == (cfg.get('android') or {}).get('backgroundColor') == '#0b0d10')
    check('a depuração do WebView não vai ligada para a loja (o Capacitor liga sozinho só no build de teste)',
          'webContentsDebuggingEnabled' not in ios and 'webContentsDebuggingEnabled' not in cfg)
    plugins = sorted(n for n in deps if n not in NAO_PLUGIN)
    inclui = ios.get('includePlugins')
    check('ios.includePlugins existe (sem ele TODO plugin do package.json entraria no iPhone)', isinstance(inclui, list))
    inclui = inclui or []
    sobra = [n for n in plugins if n not in inclui and n not in FORA_DO_IOS]
    check('todo plugin do package.json está no iPhone ou na lista do que fica fora de propósito', not sobra, sobra)
    check('o includePlugins não cita plugin que não está no package.json',
          all(n in deps for n in inclui), [n for n in inclui if n not in deps])
    check('o que fica fora de propósito NÃO está no includePlugins', not any(n in inclui for n in FORA_DO_IOS))
    return cfg, inclui


def pasta_ios(cfg, inclui, versao_ios):
    check('a pasta ios/ existe (gerada com npx cap add ios)', os.path.isdir(APP))
    if not os.path.isdir(APP):
        return
    # --- o Git: o projeto entra, o gerado fica fora
    vai = ['ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/Info.plist', 'ios/App/App/PrivacyInfo.xcprivacy',
           'ios/App/CapApp-SPM/Package.swift', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']
    ignorados = [f for f in vai if git('check-ignore', '-q', f).returncode == 0]
    check('o projeto do iPhone vai para o Git (como o android/)', not ignorados, ignorados)
    gerados = ['ios/App/App/public/index.html', 'ios/App/App/capacitor.config.json', 'ios/App/App/config.xml',
               'ios/capacitor-cordova-ios-plugins/sources/x', 'ios/App/build/x', 'ios/DerivedData/x']
    soltos = [f for f in gerados if git('check-ignore', '-q', f).returncode != 0]
    check('o que o npx cap sync ios gera (a cópia da www/, da configuração) e o build ficam fora do Git', not soltos, soltos)
    eol = git('check-attr', 'eol', '--', 'ios/App/App.xcodeproj/project.pbxproj').stdout.strip()
    check('o texto do ios/ vai LF (.gitattributes), mesmo com core.autocrlf no Windows', eol.endswith('lf'), eol)
    check('o servidor não leva a pasta ios/ (o .dockerignore e o pacote do VPS)',
          'ios' in [l.strip() for l in ler('.dockerignore').splitlines()] and 'ios' in sobe_vps.FORA)

    # --- o Package.swift que o Capacitor escreve: os mesmos plugins e a mesma versão
    pacote = ler('ios', 'App', 'CapApp-SPM', 'Package.swift')
    caminhos = sorted(re.findall(r'path: "\.\./\.\./\.\./node_modules/([^"]+)"', pacote))
    check('o Package.swift traz exatamente os plugins do includePlugins (o npx cap sync ios rodou depois da última mudança)',
          caminhos == sorted(inclui), 'Package.swift: %s' % caminhos)
    m = re.search(r'capacitor-swift-pm\.git", exact: "([0-9.]+)"', pacote)
    check('o Capacitor nativo do iPhone é o da versão do @capacitor/ios', m and m.group(1) == versao_ios,
          (m.group(1) if m else None, versao_ios))

    # --- o project.pbxproj (editado à mão: o identificador, só iPhone, a versão, o manifesto de privacidade)
    pbx = ler('ios', 'App', 'App.xcodeproj', 'project.pbxproj')
    ids = set(re.findall(r'\b[0-9A-F]{24}\b', pbx))
    definidos = set(re.findall(r'^\t\t([0-9A-F]{24}) /\*[^*]*\*/ = \{', pbx, re.M)) | \
        set(re.findall(r'^\t\t([0-9A-F]{24}) = \{', pbx, re.M))
    check('todo objeto citado no project.pbxproj existe nele', ids and ids <= definidos, sorted(ids - definidos)[:5])
    check('o project.pbxproj abre e fecha as chaves e os parênteses',
          pbx.count('{') == pbx.count('}') and pbx.count('(') == pbx.count(')'))
    alvo = re.findall(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', pbx)
    check('o identificador do iPhone é o do Android (%s)' % cfg['appId'],
          len(alvo) == 2 and set(alvo) == {cfg['appId']}, alvo)
    check('só iPhone (TARGETED_DEVICE_FAMILY = 1): sem as capturas e a revisão do iPad',
          re.findall(r'TARGETED_DEVICE_FAMILY = ([^;]+);', pbx) == ['1', '1'])
    versoes = re.findall(r'MARKETING_VERSION = ([^;]+);', pbx)
    builds = re.findall(r'CURRENT_PROJECT_VERSION = ([^;]+);', pbx)
    check('a versão (MARKETING_VERSION) é X.Y.Z e o build (CURRENT_PROJECT_VERSION) é um número',
          len(set(versoes)) == 1 and re.match(r'^\d+\.\d+\.\d+$', versoes[0]) and
          len(set(builds)) == 1 and builds[0].isdigit(), (versoes, builds))
    alvos = [float(x) for x in re.findall(r'IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);', pbx)]
    check('o iOS mínimo é o do Capacitor 8 (15.0)', alvos and min(alvos) >= 15.0, alvos)
    ref = re.search(r'([0-9A-F]{24}) /\* PrivacyInfo\.xcprivacy \*/ = \{isa = PBXFileReference', pbx)
    fase = re.search(r'/\* Resources \*/ = \{\s*isa = PBXResourcesBuildPhase;.*?files = \((.*?)\);', pbx, re.S)
    check('o manifesto de privacidade entra no aplicativo (Copy Bundle Resources)',
          ref and fase and 'PrivacyInfo.xcprivacy in Resources' in fase.group(1) and
          re.search(r'= \{isa = PBXBuildFile; fileRef = %s ' % ref.group(1), pbx))

    # --- o Info.plist
    info = plist('ios', 'App', 'App', 'Info.plist')
    deitado = ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']
    check('sempre deitado, como no Android (sensorLandscape)',
          info.get('UISupportedInterfaceOrientations') == deitado and
          info.get('UISupportedInterfaceOrientations~ipad') == deitado)
    check('sem barra de status (o jogo em tela inteira, como no Android)',
          info.get('UIStatusBarHidden') is True and info.get('UIViewControllerBasedStatusBarAppearance') is False)
    check('o nome debaixo do ícone é o appName', info.get('CFBundleDisplayName') == cfg['appName'])
    check('as perguntas do sistema (os avisos) saem nos idiomas do jogo',
          set(['pt-BR', 'en', 'es']) <= set(info.get('CFBundleLocalizations') or []))
    check('o aviso de criptografia respondido no próprio app (só HTTPS: não pergunta a cada envio)',
          info.get('ITSAppUsesNonExemptEncryption') is False)
    if '@capacitor/share' in inclui:
        check('com o compartilhar, a frase da Fotos existe (sem ela, "Salvar imagem" fecha o aplicativo)',
              bool((info.get('NSPhotoLibraryAddUsageDescription') or '').strip()))
    admob = '@capacitor-community/admob' in inclui
    chaves_admob = ['GADApplicationIdentifier', 'SKAdNetworkItems', 'NSUserTrackingUsageDescription']
    if admob:
        check('com o AdMob no iPhone, o Info.plist leva o id do AdMob, os SKAdNetwork e a frase do rastreamento '
              '(sem o id, o aplicativo fecha ao abrir)', all(k in info for k in chaves_admob),
              [k for k in chaves_admob if k not in info])
    else:
        check('sem o AdMob, o aplicativo não pede rastreamento (nenhuma frase de ATT à toa)',
              'NSUserTrackingUsageDescription' not in info)

    # --- o manifesto de privacidade
    priv = plist('ios', 'App', 'App', 'PrivacyInfo.xcprivacy')
    api = {d.get('NSPrivacyAccessedAPIType'): d.get('NSPrivacyAccessedAPITypeReasons') for d in priv.get('NSPrivacyAccessedAPITypes') or []}
    check('o manifesto declara o UserDefaults (CA92.1), que o Capacitor usa',
          'CA92.1' in (api.get('NSPrivacyAccessedAPICategoryUserDefaults') or []))
    check('o manifesto diz que não há rastreamento' + ('' if not admob else ' — REVER com o AdMob'),
          priv.get('NSPrivacyTracking') is False and not priv.get('NSPrivacyTrackingDomains'))
    tipos = {d.get('NSPrivacyCollectedDataType'): d for d in priv.get('NSPrivacyCollectedDataTypes') or []}
    check('o manifesto declara o e-mail e o id da conta, ligados à conta e sem rastreamento',
          all(tipos.get(t, {}).get('NSPrivacyCollectedDataTypeLinked') is True and
              tipos.get(t, {}).get('NSPrivacyCollectedDataTypeTracking') is False
              for t in ('NSPrivacyCollectedDataTypeEmailAddress', 'NSPrivacyCollectedDataTypeUserID')))
    check('nenhum dado do manifesto é usado para rastrear',
          tipos and all(d.get('NSPrivacyCollectedDataTypeTracking') is False for d in tipos.values()))

    # --- o ícone e a abertura (tools/icone_app.py --ios)
    pasta_icone = os.path.join(APP, 'Assets.xcassets', 'AppIcon.appiconset')
    nome_icone = [i.get('filename') for i in json.loads(ler('ios', 'App', 'App', 'Assets.xcassets',
                                                            'AppIcon.appiconset', 'Contents.json'))['images']]
    cab = png(os.path.join(pasta_icone, nome_icone[0])) if nome_icone else None
    check('o ícone é um PNG de 1024x1024 SEM transparência (a App Store recusa canal alfa)',
          cab and cab[:2] == (1024, 1024) and cab[2] == 2, cab)
    pasta_abre = os.path.join(APP, 'Assets.xcassets', 'Splash.imageset')
    abre = [i.get('filename') for i in json.loads(ler('ios', 'App', 'App', 'Assets.xcassets',
                                                       'Splash.imageset', 'Contents.json'))['images']]
    tamanhos = [png(os.path.join(pasta_abre, a)) for a in abre]
    check('a tela de abertura existe nos três tamanhos que o storyboard pede (2732x2732)',
          len(abre) == 3 and all(t and t[:2] == (2732, 2732) for t in tamanhos), tamanhos)
    # o ícone padrão do Capacitor é claro; o do jogo tem o canto no preto do jogo (#0b0d10, o FUNDO do icone_app.py)
    canto = png_canto(os.path.join(pasta_icone, nome_icone[0])) if cab and cab[2] == 2 else None
    check('o ícone é o do jogo, não o padrão do Capacitor (o canto é o preto do jogo: tools/icone_app.py --ios)',
          canto == (11, 13, 16), canto)
    canto = png_canto(os.path.join(pasta_abre, abre[0])) if tamanhos and tamanhos[0] and tamanhos[0][2] == 2 else None
    check('a abertura é a do jogo (o fundo é o preto do jogo, não o branco do Capacitor)', canto == (11, 13, 16), canto)


def receita_da_nuvem(cfg):
    """O codemagic.yaml (docs/APP_STORE.md §2): lido como texto — a máquina de casa não tem o leitor de YAML."""
    caminho = os.path.join(RAIZ, 'codemagic.yaml')
    check('a receita da compilação na nuvem existe (codemagic.yaml)', os.path.isfile(caminho))
    if not os.path.isfile(caminho):
        return
    y = ler('codemagic.yaml')
    m = re.search(r'^\s+bundle_identifier:\s*(\S+)', y, re.M)
    check('a nuvem assina o identificador do capacitor.config.json', m and m.group(1) == cfg['appId'],
          m.group(1) if m else None)
    passos = ['npm ci', 'python3 tools/empacota_www.py', 'npx cap sync ios', 'python3 tests/app_ios.py',
              'xcode-project use-profiles', 'xcode-project build-ipa --project ios/App/App.xcodeproj --scheme App']
    falta = [p for p in passos if p not in y]
    check('a nuvem faz os passos de casa, na ordem: dependências, www/, sync, esta prova, assinatura, IPA',
          not falta and [y.index(p) for p in passos] == sorted(y.index(p) for p in passos), falta)
    check('a nuvem usa o Xcode atual (a Apple exige o 26) e o Node 22 do Capacitor 8',
          re.search(r'^\s+xcode:\s*latest', y, re.M) and re.search(r'^\s+node:\s*22\b', y, re.M))
    segredos = [t for t in ('BEGIN PRIVATE KEY', 'BEGIN CERTIFICATE', 'issuer_id:', 'key_id:', 'private_key:',
                            'certificate_password', '.p8', '.p12') if t in y]
    check('nenhum segredo na receita (a chave da API e o certificado ficam guardados no Codemagic)', not segredos, segredos)
    check('o servidor não leva a receita (.dockerignore e o pacote do VPS)',
          'codemagic.yaml' in [l.strip() for l in ler('.dockerignore').splitlines()] and 'codemagic.yaml' in sobe_vps.FORA)


def main():
    deps, versao_ios = dependencias()
    cfg, inclui = configuracao(deps)
    pasta_ios(cfg, inclui, versao_ios)
    receita_da_nuvem(cfg)
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
