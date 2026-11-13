package br.com.soterra.jogo;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.InitializationConfiguration;
import com.unity3d.ads.LoadConfiguration;
import com.unity3d.ads.RewardedAd;
import com.unity3d.ads.RewardedShowListener;
import com.unity3d.ads.ShowConfiguration;
import com.unity3d.ads.ShowFinishState;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsError;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/* O ANUNCIO PREMIADO DA UNITY ADS (13/11; o dono: "ja que o AdMob nao funciona, quero a Unity").
 *
 * Um plugin do PROPRIO aplicativo (registrado no MainActivity), com tres metodos, e nada mais:
 *   inicia({jogo, teste})  liga o SDK com o Game ID que o servidor do jogo manda (nunca escrito aqui);
 *   carrega({bloco})       carrega UM anuncio premiado do bloco: {estado: 'pronto' | 'sem-anuncio'};
 *   mostra({sid})          mostra o anuncio carregado com o BILHETE do servidor como "server ID":
 *                          {estado: 'visto' | 'pulado' | 'falhou'}.
 * Quem chama e o js/core/premio_anuncio.js, so quando o jogador ENTRA na area "Ganhar premios" (inicia)
 * e TOCA em "Assistir anuncio" (carrega e mostra). Nao ha banner, intersticial nem pre-carregamento.
 *
 * O PREMIO NAO SAI DAQUI: o "visto" so faz a tela esperar. Quem credita e o servidor do jogo, quando a
 * UNITY o avisa com o sid e o hmac dela (servidor/anuncio.py, GET /api/anuncio/unity).
 *
 * O SDK e o com.unity3d.ads:unity-ads (android/app/build.gradle), pela API nova (RewardedAd, desde a 4.19):
 * a antiga UnityAds.load/show e o PlayerMetaData.setServerId (o caminho da documentacao dos avisos S2S)
 * estao marcados como obsoletos na 4.20.1. Na API nova o sid vai no withCustomRewardString: o
 * RewardedAd.show o grava como o "player server id" do anuncio — o mesmo campo que o PlayerMetaData
 * preenchia (conferido no bytecode da 4.20.1: RewardedAd$show$1 -> AdObject.setPlayerServerId). */
@CapacitorPlugin(name = "UnityAds")
public class UnityAdsPlugin extends Plugin {

    private static final Pattern JOGO = Pattern.compile("^[0-9]{5,12}$");
    private static final Pattern BLOCO = Pattern.compile("^[A-Za-z0-9_.-]{1,64}$");
    private static final Pattern SID = Pattern.compile("^[A-Za-z0-9_-]{20,64}$");

    // o SDK liga uma vez por processo; quem pede enquanto ele liga espera a mesma resposta
    private static final Object TRAVA = new Object();
    private static boolean iniciado = false;
    private static final List<PluginCall> ESPERANDO = new ArrayList<>();

    private volatile RewardedAd anuncio = null;   // o anuncio carregado, que so pode ser mostrado uma vez

    @PluginMethod
    public void inicia(PluginCall call) {
        String jogo = call.getString("jogo", "");
        boolean teste = Boolean.TRUE.equals(call.getBoolean("teste", false));
        if (jogo == null || !JOGO.matcher(jogo).matches()) {
            call.reject("Game ID invalido", "INVALID_ARGUMENT");
            return;
        }
        boolean dispara;
        synchronized (TRAVA) {
            if (iniciado) {
                call.resolve(estado("pronto"));
                return;
            }
            ESPERANDO.add(call);
            dispara = ESPERANDO.size() == 1;
        }
        if (!dispara) return;
        InitializationConfiguration cfg = new InitializationConfiguration.Builder(jogo).withTestMode(teste).build();
        try {
            UnityAds.initialize(cfg, erro -> {
                List<PluginCall> fila;
                synchronized (TRAVA) {
                    if (erro == null) iniciado = true;
                    fila = new ArrayList<>(ESPERANDO);
                    ESPERANDO.clear();
                }
                for (PluginCall c : fila) {
                    if (erro == null) c.resolve(estado("pronto"));
                    else c.reject(texto(erro.getMessage()), String.valueOf(erro.getCode()));
                }
            });
        } catch (Exception e) {
            List<PluginCall> fila;
            synchronized (TRAVA) {
                fila = new ArrayList<>(ESPERANDO);
                ESPERANDO.clear();
            }
            for (PluginCall c : fila) c.reject(texto(e.getMessage()), "INTERNAL_ERROR");
        }
    }

    @PluginMethod
    public void carrega(PluginCall call) {
        String bloco = call.getString("bloco", "");
        if (bloco == null || !BLOCO.matcher(bloco).matches()) {
            call.reject("bloco invalido", "INVALID_ARGUMENT");
            return;
        }
        synchronized (TRAVA) {
            if (!iniciado) {
                call.resolve(estado("sem-anuncio").put("codigo", "NOT_INITIALIZED"));
                return;
            }
        }
        anuncio = null;
        try {
            RewardedAd.load(new LoadConfiguration.Builder(bloco).build(), (ad, erro) -> {
                if (ad == null || erro != null) {
                    JSObject r = estado("sem-anuncio");
                    if (erro != null) {
                        r.put("codigo", erro.getCode());
                        r.put("mensagem", texto(erro.getMessage()));
                    }
                    call.resolve(r);
                    return;
                }
                // o anuncio carregado vence se ficar parado: some daqui, e o mostra responde 'falhou'
                ad.setOnAdExpired(vencido -> {
                    if (anuncio == vencido) anuncio = null;
                });
                anuncio = ad;
                call.resolve(estado("pronto"));
            });
        } catch (Exception e) {
            call.resolve(estado("sem-anuncio").put("mensagem", texto(e.getMessage())));
        }
    }

    @PluginMethod
    public void mostra(PluginCall call) {
        String sid = call.getString("sid", "");
        if (sid == null || !SID.matcher(sid).matches()) {
            call.reject("sid invalido", "INVALID_ARGUMENT");
            return;
        }
        final RewardedAd ad = anuncio;
        anuncio = null;                                   // um anuncio carregado, uma vez
        final Activity tela = getActivity();
        if (ad == null || tela == null) {
            call.resolve(estado("falhou").put("codigo", ad == null ? "NOT_READY" : "NO_ACTIVITY"));
            return;
        }
        // o servidor do jogo so credita com o bilhete de volta: ele e o "server ID" (sid) do aviso da Unity
        final ShowConfiguration cfg = new ShowConfiguration.Builder().withCustomRewardString(sid).build();
        final AtomicBoolean respondido = new AtomicBoolean(false);
        final AtomicBoolean premiado = new AtomicBoolean(false);
        final RewardedShowListener ouvinte = new RewardedShowListener() {
            @Override
            public void onRewarded(RewardedAd a) {
                premiado.set(true);
            }

            @Override
            public void onStarted(RewardedAd a) {}

            @Override
            public void onClicked(RewardedAd a) {}

            @Override
            public void onCompleted(RewardedAd a, ShowFinishState fim) {
                if (!respondido.compareAndSet(false, true)) return;
                call.resolve(estado(premiado.get() || fim == ShowFinishState.COMPLETED ? "visto" : "pulado"));
            }

            @Override
            public void onFailed(RewardedAd a, UnityAdsError erro) {
                if (!respondido.compareAndSet(false, true)) return;
                JSObject r = estado("falhou");
                if (erro != null) {
                    r.put("codigo", erro.getCode());
                    r.put("mensagem", texto(erro.getMessage()));
                }
                call.resolve(r);
            }
        };
        tela.runOnUiThread(() -> {
            try {
                ad.show(tela, cfg, ouvinte);
            } catch (Exception e) {
                if (respondido.compareAndSet(false, true)) call.resolve(estado("falhou").put("mensagem", texto(e.getMessage())));
            }
        });
    }

    private static JSObject estado(String estado) {
        JSObject r = new JSObject();
        r.put("estado", estado);
        return r;
    }

    private static String texto(String s) {
        return s == null ? "" : (s.length() > 300 ? s.substring(0, 300) : s);
    }
}
