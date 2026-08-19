using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Fx
{
    /// <summary>
    /// O POOL de efeitos: quem guarda os sistemas montados e os empresta.
    ///
    /// Nunca <c>Instantiate</c> nem <c>Destroy</c> por conjuração. O destino é
    /// celular, e criar um GameObject com ParticleSystem a cada feitiço é a
    /// receita conhecida de engasgo: a alocação e o coletor de lixo chegam
    /// exatamente no quadro em que o jogador está olhando o efeito. Cada família
    /// tem um punhado de cópias, montadas uma vez, ligadas e desligadas.
    ///
    /// Montagem PREGUIÇOSA, família a família: uma sala usa seis ou sete das 21,
    /// e pagar as outras catorze na entrada da sala seria cobrar por efeito que
    /// não vai acontecer. Quem quer todas de uma vez (o teste, a foto) chama
    /// <see cref="PrepararTodas"/>.
    /// </summary>
    public sealed class BancoDeEfeitos
    {
        /// <summary>
        /// Cópias por família. Três, e o número tem razão: a pausa entre jogadas
        /// do monstro é 0,55 s (<c>JogoDeBatalha.PausaEntreJogadas</c>) e a
        /// armadilha fica 1,8 s no chão — três jogadas seguidas da mesma família
        /// se sobrepõem, e com duas cópias a terceira cortaria a primeira.
        /// </summary>
        public const int CopiasPorFamilia = 3;

        readonly Transform _raiz;
        readonly AtlasDeEfeito _atlas;
        readonly IDictionary<string, MoldeDeEfeito> _moldes;
        readonly Dictionary<string, List<SistemaDeEfeito>> _pool =
            new Dictionary<string, List<SistemaDeEfeito>>();
        readonly Dictionary<string, int> _rodizio = new Dictionary<string, int>();
        readonly List<SistemaDeEfeito> _todos = new List<SistemaDeEfeito>();

        int _semente = 20260819;

        public AtlasDeEfeito Atlas { get { return _atlas; } }
        public Transform Raiz { get { return _raiz; } }

        /// <summary>Sistemas já montados. Cresce até 21 × <see cref="CopiasPorFamilia"/>.</summary>
        public int Montados { get { return _todos.Count; } }

        BancoDeEfeitos(Transform raiz, AtlasDeEfeito atlas, IDictionary<string, MoldeDeEfeito> moldes)
        {
            _raiz = raiz;
            _atlas = atlas;
            _moldes = moldes;
        }

        /// <summary>
        /// Cria o banco pendurado num objeto próprio. O pai costuma ser o
        /// tabuleiro do palco: pendurado nele, o efeito GIRA junto com a sala —
        /// pendurado fora, uma explosão ficaria parada enquanto o chão embaixo
        /// dela vira 90°.
        /// </summary>
        public static BancoDeEfeitos Criar(Transform pai = null)
        {
            var go = new GameObject("Efeitos");
            if (pai != null) go.transform.SetParent(pai, false);
            return new BancoDeEfeitos(go.transform, AtlasDeEfeito.CarregarDeResources(),
                                      MoldeDeEfeito.Todos());
        }

        /// <summary>Monta as 21 de uma vez — para o teste medir o pico real e
        /// para a foto não pagar a montagem no meio do efeito.</summary>
        public void PrepararTodas()
        {
            for (int i = 0; i < FamiliaDeEfeito.Todas.Count; i++) Fila(FamiliaDeEfeito.Todas[i]);
        }

        // ============================================================= DISPARAR

        /// <summary>
        /// Toca o efeito de uma família entre duas posições de MUNDO. Devolve o
        /// sistema emprestado, ou nulo se a família não existir — e não existir
        /// é erro de programação, porque <see cref="FamiliaDeEfeito.DeChave"/>
        /// nunca devolve nome de fora da lista.
        /// </summary>
        public SistemaDeEfeito Disparar(string familia, Vector3 origem, Vector3 destino, Color cor)
        {
            var fila = Fila(familia);
            if (fila == null || fila.Count == 0) return null;

            SistemaDeEfeito escolhido = null;
            for (int i = 0; i < fila.Count && escolhido == null; i++)
                if (!fila[i].Ocupado) escolhido = fila[i];

            if (escolhido == null)
            {
                // Todas ocupadas: reaproveita por rodízio, cortando a MAIS
                // ANTIGA. Cortar um efeito velho é ruim; engolir o novo em
                // silêncio é pior — seria o feitiço acertando sem aparecer, que
                // é exatamente o defeito que esta rodada existe para matar.
                int i;
                _rodizio.TryGetValue(familia, out i);
                escolhido = fila[i % fila.Count];
                _rodizio[familia] = (i + 1) % fila.Count;
                escolhido.Parar();
            }

            escolhido.Disparar(origem, destino, cor);
            return escolhido;
        }

        List<SistemaDeEfeito> Fila(string familia)
        {
            if (string.IsNullOrEmpty(familia)) return null;

            List<SistemaDeEfeito> fila;
            if (_pool.TryGetValue(familia, out fila)) return fila;

            MoldeDeEfeito molde;
            if (!_moldes.TryGetValue(familia, out molde)) return null;

            fila = new List<SistemaDeEfeito>(CopiasPorFamilia);
            for (int i = 0; i < CopiasPorFamilia; i++)
            {
                var s = SistemaDeEfeito.Montar(molde, _atlas, _raiz, _semente);
                _semente += 104729;
                fila.Add(s);
                _todos.Add(s);
            }
            _pool[familia] = fila;
            return fila;
        }

        // ============================================================== AVANÇAR

        /// <summary>Um quadro de tempo para todo mundo. Chamado pelo
        /// <c>JogoDeBatalha</c> junto com a animação do elenco.</summary>
        public void Avancar(float dt)
        {
            for (int i = 0; i < _todos.Count; i++) _todos[i].Avancar(dt);
        }

        /// <summary>Apaga tudo que está no ar — troca de sala, fim de batalha.</summary>
        public void Limpar()
        {
            for (int i = 0; i < _todos.Count; i++) _todos[i].Parar();
        }

        // =============================================================== CUSTO

        /// <summary>Partículas VIVAS agora, somando tudo. É o número honesto do
        /// custo, e o único que um teste sem tela consegue medir.</summary>
        public int ParticulasVivas()
        {
            int n = 0;
            for (int i = 0; i < _todos.Count; i++) n += _todos[i].ParticulasVivas();
            return n;
        }

        /// <summary>Sistemas com efeito no ar agora.</summary>
        public int SistemasOcupados()
        {
            int n = 0;
            for (int i = 0; i < _todos.Count; i++) if (_todos[i].Ocupado) n++;
            return n;
        }

        /// <summary>
        /// O TETO teórico: se todas as cópias de todas as famílias estivessem no
        /// ar ao mesmo tempo, quantas partículas seriam. É o pior caso do
        /// orçamento de celular — e é um caso que o jogo não alcança, porque uma
        /// batalha não conjura 21 famílias no mesmo quadro.
        /// </summary>
        public int TetoDeParticulas()
        {
            int n = 0;
            foreach (var molde in _moldes.Values) n += molde.TetoDeParticulas * CopiasPorFamilia;
            return n;
        }

        /// <summary>O teto de UMA conjuração da família — o custo que o jogador
        /// paga de verdade quando lança um feitiço.</summary>
        public int TetoDaFamilia(string familia)
        {
            MoldeDeEfeito molde;
            return _moldes.TryGetValue(familia, out molde) ? molde.TetoDeParticulas : 0;
        }

        public MoldeDeEfeito Molde(string familia)
        {
            MoldeDeEfeito molde;
            return _moldes.TryGetValue(familia, out molde) ? molde : null;
        }
    }
}
