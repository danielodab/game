package br.com.soterra.jogo;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        telaCheia();
    }

    @Override
    public void onResume() {
        super.onResume();
        telaCheia();
    }

    // o teclado, um aviso do sistema ou o anuncio devolvem as barras: ao voltar o foco, somem de novo
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) telaCheia();
    }

    /* 06/10 (o dono, no primeiro aparelho): "a barra superior do horario e bateria do celular nao some,
     * nem a barra dos botoes do sistema". Jogo e tela inteira: as duas barras ficam escondidas e voltam
     * por um instante quando o jogador desliza da borda (o gesto de sempre do Android). O desenho entra
     * tambem na faixa do furo da camera; o jogo ja se afasta dela pelo env(safe-area-inset-*). */
    private void telaCheia() {
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }
            WindowInsetsControllerCompat barras =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            barras.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            barras.hide(WindowInsetsCompat.Type.systemBars());
        } catch (Exception e) {
            // aparelho que nao deixa esconder: o jogo segue com as barras, como antes
        }
    }
}
