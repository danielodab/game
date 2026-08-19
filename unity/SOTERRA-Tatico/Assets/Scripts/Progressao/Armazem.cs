using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Progressao
{
    /// <summary>
    /// Onde o save mora.
    ///
    /// Existe como interface, e não como chamada direta a <c>PlayerPrefs</c>,
    /// pelo mesmo motivo de <c>IFonteDeTexto</c>: um teste que gravasse em
    /// <c>PlayerPrefs</c> sujaria o registro da máquina de quem roda o lote e
    /// ainda passaria o resultado de uma execução para a seguinte — dois testes
    /// de save que se contaminam não provam nada sobre carregar do zero.
    ///
    /// <see cref="Gravar"/> devolve <c>bool</c> e nunca lança: gravação negada
    /// (disco cheio, modo restrito) é estado esperado, e o jogo tem de continuar
    /// jogável em memória. Progresso que não sobrevive a fechar o jogo é ruim;
    /// jogo que morre porque não conseguiu gravar é pior.
    /// </summary>
    public interface IArmazem
    {
        /// <summary>O texto guardado, ou <c>null</c> se a chave nunca foi gravada.</summary>
        string Ler(string chave);

        /// <summary>Devolve <c>false</c> se a gravação foi negada. Não lança.</summary>
        bool Gravar(string chave, string texto);
    }

    /// <summary>
    /// O armazém de produção: <c>PlayerPrefs</c>.
    ///
    /// <c>PlayerPrefs</c> e não arquivo em <c>Application.persistentDataPath</c>
    /// porque ele é o único que funciona igual no Editor, no player Windows e no
    /// WebGL — no WebGL ele já É o <c>localStorage</c>, que é exatamente onde o
    /// save do JS mora hoje.
    ///
    /// O <c>Save()</c> é explícito a cada gravação, e não só no fechar: o jogo é
    /// de celular e pode ser morto pelo sistema sem aviso.
    /// </summary>
    public sealed class ArmazemDePlayerPrefs : IArmazem
    {
        public string Ler(string chave)
        {
            if (string.IsNullOrEmpty(chave)) return null;
            return PlayerPrefs.HasKey(chave) ? PlayerPrefs.GetString(chave) : null;
        }

        public bool Gravar(string chave, string texto)
        {
            if (string.IsNullOrEmpty(chave)) return false;
            try
            {
                PlayerPrefs.SetString(chave, texto ?? string.Empty);
                PlayerPrefs.Save();
                return true;
            }
            catch (System.Exception)
            {
                // Gravação negada não pode derrubar a partida — ver o resumo da
                // interface. O estado continua vivo em memória.
                return false;
            }
        }
    }

    /// <summary>
    /// Armazém de teste: um dicionário. É ele que permite fechar e reabrir o
    /// jogo dentro de um teste — grava com um <see cref="Progresso"/> e carrega
    /// com outro, sobre o MESMO armazém.
    /// </summary>
    public sealed class ArmazemDeMemoria : IArmazem
    {
        readonly Dictionary<string, string> _textos = new Dictionary<string, string>();

        /// <summary>Quantas vezes <see cref="Gravar"/> foi chamado. O teste cobra que salvar é automático.</summary>
        public int Gravacoes { get; private set; }

        public string Ler(string chave)
        {
            string t;
            return _textos.TryGetValue(chave ?? string.Empty, out t) ? t : null;
        }

        public bool Gravar(string chave, string texto)
        {
            _textos[chave ?? string.Empty] = texto;
            Gravacoes++;
            return true;
        }
    }

    /// <summary>
    /// Armazém que recusa tudo — o <c>file://</c>, o modo privado e o headless
    /// do JS, num tipo só. Serve para provar que o jogo roda inteiro sem
    /// persistência: nenhuma API pode lançar por causa disso.
    /// </summary>
    public sealed class ArmazemSurdo : IArmazem
    {
        public string Ler(string chave) { return null; }
        public bool Gravar(string chave, string texto) { return false; }
    }
}
