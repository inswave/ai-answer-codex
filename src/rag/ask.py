"""
RAG answer helper.

Searches the local Chroma index and, when Codex CLI is available, asks
`codex exec` to draft an answer from the retrieved context. No direct LLM API
keys are used by this script.
"""

import os
import subprocess
import sys
import tempfile


DB_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")


def search(query, n_results=8):
    """Run vector search."""
    import chromadb
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

    embedding_fn = SentenceTransformerEmbeddingFunction(
        model_name="paraphrase-multilingual-MiniLM-L12-v2"
    )

    client = chromadb.PersistentClient(path=DB_DIR)
    collection = client.get_collection(
        name="tech_support",
        embedding_function=embedding_fn,
    )

    return collection.query(
        query_texts=[query],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )


def build_context(results):
    """Convert search results to a compact text context."""
    context_parts = []

    for i, (doc, meta, dist) in enumerate(
        zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        )
    ):
        similarity = max(0, 1 - dist)
        context_parts.append(
            f"[Reference {i + 1}] (similarity: {similarity:.0%}, source: {meta.get('source', '')})\n"
            f"Title: {meta.get('title', '')}\n"
            f"{doc[:2000]}\n"
        )

    return "\n---\n".join(context_parts)


def generate_answer_with_codex(query, context):
    """Generate an answer through Codex CLI."""
    prompt = f"""You are a WebSquare technical support specialist.

Write a concise Korean support-answer draft from the provided references.

Rules:
- Use only the provided references when they are relevant.
- Do not invent WebSquare APIs, events, properties, versions, or patches.
- If the references do not prove a point, say that confirmation is needed.
- Do not include a separate sources section in the answer body.

References:
{context}

Customer question:
{query}

Draft the answer now."""

    with tempfile.NamedTemporaryFile("w+", encoding="utf-8", delete=False) as output:
        output_path = output.name

    try:
        proc = subprocess.run(
            [
                "codex",
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--output-last-message",
                output_path,
                "-",
            ],
            input=prompt,
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=300,
        )
        if proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout[-500:]
            raise RuntimeError(f"codex exec failed: {detail}")

        with open(output_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


def generate_answer_template(query, results):
    """Fallback answer material when Codex CLI is unavailable."""
    output = []
    output.append("=" * 70)
    output.append("  RAG search result based answer material")
    output.append("=" * 70)
    output.append(f"\nQuestion: {query}\n")

    if results["documents"][0]:
        best = results["documents"][0][0]
        meta = results["metadatas"][0][0]
        dist = results["distances"][0][0]
        similarity = max(0, 1 - dist)

        output.append(f"\nTop source: {meta.get('title', '')} ({similarity:.0%})")
        output.append(f"Source: {meta.get('source', '')} | Date: {meta.get('date', '')}\n")
        output.append(best[:2000])

    output.append(f"\n{'-' * 70}")
    output.append("  Additional references")
    output.append("-" * 70)

    for i in range(1, min(len(results["documents"][0]), 5)):
        doc = results["documents"][0][i]
        meta = results["metadatas"][0][i]
        dist = results["distances"][0][i]
        similarity = max(0, 1 - dist)

        output.append(f"\n[{i + 1}] {meta.get('title', '')} ({similarity:.0%})")
        answer_start = doc.find("답변:")
        if answer_start >= 0:
            output.append(doc[answer_start : answer_start + 500])
        else:
            output.append(doc[:500])

    output.append(f"\n{'=' * 70}")
    return "\n".join(output)


def main():
    if len(sys.argv) < 2:
        print('Usage: python src/rag/ask.py "question" [top_k]')
        print("")
        print('Example: python src/rag/ask.py "gridView cell merge method"')
        print("")
        print("If Codex CLI is installed and authenticated, this script uses codex exec.")
        print("Otherwise it prints RAG-based answer material.")
        sys.exit(0)

    query = sys.argv[1]
    n_results = int(sys.argv[2]) if len(sys.argv) > 2 else 8

    print(f'Question: "{query}"\n')
    print("Searching...\n")

    results = search(query, n_results)

    if not results["documents"][0]:
        print("No related material found.")
        return

    context = build_context(results)

    try:
        print("Generating answer with Codex CLI...\n")
        answer = generate_answer_with_codex(query, context)
        print("=" * 70)
        print("  Codex generated answer")
        print("=" * 70)
        print(f"\n{answer}\n")
        print("=" * 70)
    except Exception as err:
        print(f"Codex generation unavailable: {err}\n")
        print(generate_answer_template(query, results))


if __name__ == "__main__":
    main()
