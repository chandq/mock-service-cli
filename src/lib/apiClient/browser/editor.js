const { EditorView, lineNumbers, keymap, highlightActiveLine } = require('@codemirror/view');
const { EditorState } = require('@codemirror/state');
const { defaultKeymap, history, historyKeymap, indentWithTab, redo } = require('@codemirror/commands');
const {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput
} = require('@codemirror/language');
const { json } = require('@codemirror/lang-json');
const { xml } = require('@codemirror/lang-xml');
const { tags } = require('@lezer/highlight');
const { search, searchKeymap, openSearchPanel } = require('@codemirror/search');
const { closeBrackets, closeBracketsKeymap } = require('@codemirror/autocomplete');
const highlightStyle = HighlightStyle.define([
  { tag: [tags.propertyName, tags.attributeName], class: 'syntax-key' },
  { tag: [tags.string, tags.attributeValue], class: 'syntax-string' },
  { tag: tags.number, class: 'syntax-number' },
  { tag: [tags.bool, tags.null, tags.keyword], class: 'syntax-keyword' },
  { tag: tags.tagName, class: 'syntax-key' },
  { tag: [tags.punctuation, tags.angleBracket], class: 'syntax-punctuation' },
  { tag: tags.comment, class: 'syntax-comment' }
]);
window.createApiEditor = (parent, value, onChange, language) => {
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        syntaxHighlighting(highlightStyle),
        bracketMatching(),
        foldGutter(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        closeBrackets(),
        search(),
        keymap.of([
          { key: 'Mod-Shift-z', run: redo },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab
        ]),
        ...(language === 'json' ? [json()] : language === 'xml' ? [xml()] : []),
        EditorView.contentAttributes.of({ 'aria-label': '请求正文', spellcheck: 'false' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { color: 'var(--text)', backgroundColor: 'var(--surface)' },
          '.cm-activeLine': { backgroundColor: 'var(--subtle)' },
          '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--subtle)' },
          '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' }
        })
      ]
    })
  });
  return {
    destroy: () => editor.destroy(),
    focus: () => editor.focus(),
    search: () => openSearchPanel(editor),
    replaceText: value => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  };
};
