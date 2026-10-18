# Editable translation prompts

The translation model is only one part of the reading experience. Literal word order, unresolved agency and unnecessarily formal diction can make otherwise accurate paragraphs difficult to read. Users need to control translation instructions independently of their provider and key.

## Reference

Immersive Translate separates translation instructions from source input, supports template variables and offers selectable “AI experts” made from prompt configurations. Its public documentation also describes context and terminology inputs:

- [Official prompt guide](https://immersivetranslate.com/zh-Hans/docs/prompts/)
- [Official AI expert repository](https://github.com/immersive-translate/prompts)

These references inform the interaction pattern. LeafRead's templates and implementation are original; no expert prompts or provider-specific formats were copied.

## LeafRead behavior

Both **Me → AI connection** and the reader's AI settings provide a translation prompt editor, three editable starting points (Natural, Academic, Close to source), a Custom state and reset to default. Users can write instructions, term choices and examples in any language. The default asks for clear contemporary prose, faithful reasoning and terminology, natural sentence structure and modern Chinese instead of archaic or mechanical phrasing.

`{{to}}` and `{{from}}` expand once to the target and source languages. Book titles, ordered source segments, chapter context, previous translated text, and accumulated glossary entries remain separate reference data. The chapter translator requires structured JSON with original segment IDs; this output contract takes precedence over formatting instructions in a custom prompt. Reading chat and retrieval prompts are unchanged.

`AIConnection.translationPrompt` stores account instructions in PostgreSQL. An empty value resolves to the default. Older clients that omit the field preserve the current value. Local mode keeps the prompt in browser preferences and excludes API keys from persistence. The account endpoint accepts at most 6000 prompt characters.

Each new book edition snapshots the effective prompt, normalized endpoint, and model. Saving settings affects future editions and does not cancel a running edition or hide completed translations. To apply new instructions to a book, choose **Retranslate book with latest settings** in Book translation. The old edition remains selected until the replacement is complete and the reader chooses to switch. Originals, legacy cache entries, and versioned note anchors are retained.

Workers use the current account credential only with the frozen edition endpoint. A changed endpoint stops that job until the old connection is restored or a new edition is created. See [persistent book translations](chapter-translations.md) for checkpointing, glossary accumulation, publication, and local-mode behavior.

## Validation boundary

Use Prisma generation, TypeScript compilation, production build and deployment readiness checks. Per project instructions, no unit, integration or E2E tests and no paid model requests are run. Translation quality and the interactive settings flow remain for the user to verify.
