using UnityEngine;

namespace Soterra.Jogo
{
    using Cena = global::Soterra.Cena;

    /// <summary>
    /// De um raio (o dedo, o mouse) para uma casa do tabuleiro.
    ///
    /// SEM raycast de física, de propósito: as casas não têm colisor — o Palco
    /// não os cria porque um mapa de 27×23 seriam 621 colisores que ninguém usa.
    /// O chão é o plano matemático y = 0 do mundo, e <c>Palco.Casa</c> desfaz
    /// giro e centragem por conta. O tabuleiro só gira em torno de Y, então o
    /// plano do chão é o mesmo em qualquer rotação.
    ///
    /// Separado do <c>MonoBehaviour</c> porque isto é a metade TESTÁVEL do
    /// toque: um raio entra, uma casa sai, e o teste EditMode cobra o par
    /// exato sem precisar de tela — que é onde o erro de meio passo (clique na
    /// casa vizinha) seria caro demais para só aparecer jogando.
    /// </summary>
    public static class Apontador
    {
        /// <summary>
        /// A casa que o raio toca no chão, ou nulo: raio paralelo ao chão,
        /// apontando para longe dele, ou caindo fora do mapa. O "fora do mapa"
        /// é recusado AQUI para o chamador não mandar ao motor uma casa que
        /// nem existe no desenho da sala.
        /// </summary>
        public static Vector2Int? CasaDoRaio(Cena.Palco palco, Ray raio)
        {
            if (palco == null || palco.Mapa == null) return null;

            var chao = new Plane(Vector3.up, Vector3.zero);
            float distancia;
            if (!chao.Raycast(raio, out distancia)) return null;

            var casa = palco.Casa(raio.GetPoint(distancia));
            if (!palco.Mapa.Dentro(casa)) return null;
            return casa;
        }

        /// <summary>A casa sob um ponto de TELA (posição do Input System, origem
        /// no canto de baixo). É só a construção do raio mais
        /// <see cref="CasaDoRaio"/> — a conta mora num lugar só.</summary>
        public static Vector2Int? CasaSobPonteiro(Camera camera, Cena.Palco palco, Vector2 tela)
        {
            if (camera == null) return null;
            return CasaDoRaio(palco, camera.ScreenPointToRay(new Vector3(tela.x, tela.y, 0f)));
        }
    }
}
