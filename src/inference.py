#!/usr/bin/env python3
"""VoiceForge local inference script for MLX and CUDA backends.

Usage:
  python3 inference.py --backend mlx --model <path> [--adapter <path>]
  python3 inference.py --backend cuda --model <path> [--adapter <path>]

Reads one JSON request from stdin: {"messages":[...], "max_tokens":N, "temperature":T}
Prints {"response":"text"} to stdout, then exits.
"""

import argparse
import json
import sys


def build_prompt(messages):
    """Build a chat prompt string from messages list."""
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"<|im_start|>system\n{content}<|im_end|>")
        elif role == "user":
            parts.append(f"<|im_start|>user\n{content}<|im_end|>")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


def run_mlx(model_path, adapter_path, request):
    """Run inference using MLX backend (Apple Silicon)."""
    from mlx_lm import load, generate

    adapter_kwarg = {"adapter_path": adapter_path} if adapter_path else {}
    model, tokenizer = load(model_path, **adapter_kwarg)

    prompt = build_prompt(request["messages"])
    max_tokens = request.get("max_tokens", 50)
    temperature = request.get("temperature", 0.9)

    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        temp=temperature,
    )
    return response.strip()


def run_cuda(model_path, adapter_path, request):
    """Run inference using CUDA/transformers backend (NVIDIA GPU)."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True,
    )

    if adapter_path:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter_path)

    prompt = build_prompt(request["messages"])
    max_tokens = request.get("max_tokens", 50)
    temperature = request.get("temperature", 0.9)

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=temperature,
            do_sample=temperature > 0,
        )
    # Decode only the generated tokens (exclude prompt)
    generated = outputs[0][inputs["input_ids"].shape[1]:]
    response = tokenizer.decode(generated, skip_special_tokens=True)
    return response.strip()


def main():
    parser = argparse.ArgumentParser(description="VoiceForge local inference")
    parser.add_argument("--backend", required=True, choices=["mlx", "cuda"])
    parser.add_argument("--model", required=True, help="Model path or HF repo ID")
    parser.add_argument("--adapter", default=None, help="LoRA adapter path")
    args = parser.parse_args()

    # Read request from stdin
    try:
        request = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}), flush=True)
        sys.exit(1)

    # Run inference
    try:
        if args.backend == "mlx":
            text = run_mlx(args.model, args.adapter, request)
        else:
            text = run_cuda(args.model, args.adapter, request)
        print(json.dumps({"response": text}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
