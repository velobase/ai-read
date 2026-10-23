# Editable translation prompts

The translation model is only one part of the reading experience. Literal word order, unresolved agency and unnecessarily formal diction can make otherwise accurate paragraphs difficult to read. Users need to control translation instructions independently of their provider and key.

## Reference

Immersive Translate separates translation instructions from source input, supports template variables and offers selectable “AI experts” made from prompt configurations. Its public documentation also describes context and terminology inputs:

- [Official prompt guide](https://immersivetranslate.com/zh-Hans/docs/prompts/)
- [Official AI expert repository](https://github.com/immersive-translate/prompts)

These references inform the interaction pattern. LeafRead's templates and implementation are original; no expert prompts or provider-specific formats were copied.

## LeafRead behavior

Both **Me → AI connection** and the reader's AI settings provide a translation prompt editor, three editable starting points (Natural, Academic, Close to source), a Custom state and reset to default. Users can write instructions, term choices and examples in any language. The default asks for clear contemporary prose, faithful reasoning and terminology, natural sentence structure and modern Chinese instead of archaic or mechanical phrasing.

`{{to}}` and `{{from}}` expand once to the target and source languages. Book titles and nearby original passages remain separate reference data. Reading translation produces paragraph text through the streaming AI endpoint; only successfully completed paragraphs enter the saved reading content. Reading chat and retrieval prompts are unchanged.

`AIConnection.translationPrompt` stores account instructions in PostgreSQL. An empty value resolves to the default. Local mode keeps the prompt in browser preferences and excludes API keys from persistence. The account endpoint accepts at most 6000 prompt characters.

Saving settings affects subsequent missing passages in the current reading demand. Already saved translations are reused, with their immutable keys and annotation anchors intact. There is no whole-book retranslation or edition-switching step in the reading flow. A source, language or configuration change invalidates incompatible partial work; compatible completed chunks remain resumable when that passage is needed again.

Translation uses the existing account or local service connection. Reading preferences and saved draft identities do not contain API keys. See [translation while reading](chapter-translations.md) and [native reading translation](native-translation.md) for nearby demand, complete-paragraph publication and retained historical translations.

## Validation boundary

Use Prisma generation, TypeScript compilation, production build and deployment readiness checks. Per project instructions, no unit, integration or E2E tests and no paid model requests are run. Translation quality and the interactive settings flow remain for the user to verify.
