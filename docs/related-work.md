# Related Work Notes for Mio Paper V0

This file is a working related-work map for a Mio paper. It is not a final BibTeX file. Every source below should be rechecked before submission, but each item has a stable paper page, DOI, ACL Anthology page, arXiv page, or publisher page that can seed the final bibliography.

## Positioning Summary

Mio should not be framed as a generic LLM chatbot. The defensible positioning is a state-coupled companion-agent architecture: long-term memory, structured temporal user facts, persona retrieval, affective state, relationship state, crisis/safety checks, silence policy, proactive policy, and a web-facing interaction loop are updated and evaluated together.

The closest research clusters are:

- Long-term conversational memory and memory-augmented agents.
- Persona and identity consistency in dialogue agents.
- Emotional support dialogue systems.
- Generative/social agent architectures.
- Companion-agent benchmarks that join memory, emotion, privacy, and environment.
- Mental-health safety and crisis-response evaluation for conversational agents.

## Long-Term Memory for Conversational Agents

MemoryBank is the closest direct precedent for long-term AI companion memory. It proposes a long-term memory mechanism and demonstrates it through SiliconFriend, an LLM-based companion chatbot that recalls user memories and supports psychological dialogue. Mio differs by coupling memory with persona graph retrieval, PAD affect, relationship stages, ghost/proactive policies, and an explicit ablation harness.

MemGPT frames long-context use as virtual context management, where an LLM manages memory tiers through read/write operations. Mio shares the motivation of finite-context memory management but does not ask the model to autonomously page its own context; Mio instead uses code-level memory stores, retrieval, and priority-bounded prompt construction.

LoCoMo evaluates very long-term conversational memory across multi-session dialogues grounded in personas and temporal event graphs. It is a natural external benchmark candidate for Mio because it stresses temporal reasoning, event summarization, and long-range grounding.

Key sources:

- Zhong, W., Guo, L., Gao, Q., Ye, H., & Wang, Y. (2024). MemoryBank: Enhancing Large Language Models with Long-Term Memory. AAAI 2024. DOI: https://doi.org/10.1609/aaai.v38i17.29946
- Packer, C., Wooders, S., Lin, K., Fang, V., Patil, S. G., Stoica, I., & Gonzalez, J. E. (2023). MemGPT: Towards LLMs as Operating Systems. arXiv:2310.08560. https://arxiv.org/abs/2310.08560
- Maharana, A., Lee, D.-H., Tulyakov, S., Bansal, M., Barbieri, F., & Fang, Y. (2024). Evaluating Very Long-Term Conversational Memory of LLM Agents. ACL 2024. https://aclanthology.org/2024.acl-long.747/

## Persona and Identity Consistency

PersonaChat established a widely used dataset and framing for persona-conditioned dialogue: generic chit-chat models lack specificity and consistent personality, while explicit profile conditioning improves personal dialogue. Mio inherits that motivation but treats persona as an active graph derived from `soul.md`, retrieved under a token budget instead of injected as a static full prompt.

Recent role-playing and persona benchmarks, including RoleLLM, CharacterBench, and PersonaGym, emphasize that persona fidelity is multi-dimensional and hard to evaluate with static profiles alone. These works can justify adding stronger persona probes and LLM/human judges in Mio's next evaluation stage.

Key sources:

- Zhang, S., Dinan, E., Urbanek, J., Szlam, A., Kiela, D., & Weston, J. (2018). Personalizing Dialogue Agents: I have a dog, do you have pets too? ACL 2018. DOI: https://doi.org/10.18653/v1/P18-1205
- Wang, Z. M., Peng, Z., Que, H., Liu, J., Zhou, W., Wu, Y., Guo, H., Gan, R., Ni, Z., Yang, J., Zhang, M., Zhang, Z., Ouyang, W., Xu, K., Huang, S. W., Fu, J., & Peng, J. (2024). RoleLLM: Benchmarking, Eliciting, and Enhancing Role-Playing Abilities of Large Language Models. Findings of ACL 2024. https://aclanthology.org/2024.findings-acl.878/
- CharacterBench: Benchmarking Character Customization of LLMs. AAAI 2025. Publisher page/PDF should be verified from the final AAAI proceedings before use.
- PersonaGym: Evaluating Persona Agents and LLMs. Findings of EMNLP 2025. Anthology page should be verified before use.

## Emotional Support Dialogue

ESConv is the foundational emotional-support dialogue dataset. It defines emotional support conversation as a task grounded in helping skills and annotates support strategies. Mio's emotional-support claim should be modest: the current benchmark measures whether state-coupled context helps generate personalized support signals, not whether Mio is clinically effective.

ES-MemEval is especially aligned with Mio because it combines long-term memory with personalized emotional support. It evaluates information extraction, temporal reasoning, conflict detection, abstention, and user modeling across QA, summarization, and dialogue generation. Mio's synthetic benchmark overlaps with these dimensions but is smaller and deterministic.

Key sources:

- Liu, S., Zheng, C., Demasi, O., Sabour, S., Li, Y., Yu, Z., Jiang, Y., & Huang, M. (2021). Towards Emotional Support Dialog Systems. ACL 2021. https://aclanthology.org/2021.acl-long.269/
- ES-MemEval: Benchmarking Conversational Agents on Personalized Long-Term Emotional Support. arXiv:2602.01885. https://arxiv.org/html/2602.01885

## Generative and Social Agent Architectures

Generative Agents introduced a memory-reflection-planning architecture for believable simulated agents. Mio is not a multi-agent social simulation, but it shares the idea that persistent behavior emerges from memory records, reflection-like summaries, and retrieval into action/response generation.

ReAct is useful background for tool-using LLM agents: it argues for interleaving reasoning and action to improve interpretability and task performance. Mio's agent loop similarly treats external tools, memory writes, and side effects as first-class actions, although the current paper should focus on companion-state coupling rather than general reasoning.

Key sources:

- Park, J. S., O'Brien, J. C., Cai, C. J., Morris, M. R., Liang, P., & Bernstein, M. S. (2023). Generative Agents: Interactive Simulacra of Human Behavior. UIST 2023. DOI: https://doi.org/10.1145/3586183.3606763
- Yao, S., Zhao, J., Yu, D., Shafran, I., Narasimhan, K., & Cao, Y. (2023). ReAct: Synergizing Reasoning and Acting in Language Models. ICLR 2023. https://openreview.net/forum?id=tvI4u1ylcqs

## Affective State and Companion-Agent Evaluation

Mio uses a PAD-like affect representation. The original PAD model describes emotion through pleasure, arousal, and dominance; Mio uses it as an engineering state representation, not as a validated psychological measurement instrument.

LifeSide is a high-level benchmark match because it frames lifelong digital companions as Memory-Emotion-Environment loops and explicitly argues that existing evaluations isolate memory recall and empathy. Mio's evaluation v1 is much smaller but motivated by the same gap.

Key sources:

- Mehrabian, A., & Russell, J. A. (1974). The Basic Emotional Impact of Environments. Perceptual and Motor Skills, 38(1), 283-301. DOI: https://doi.org/10.2466/pms.1974.38.1.283
- Russell, J. A., & Mehrabian, A. (1977). Evidence for a Three-Factor Theory of Emotions. Journal of Research in Personality, 11(3), 273-294. DOI should be verified from publisher metadata.
- LifeSide: Benchmarking Agents as Lifelong Digital Companions. arXiv:2606.04660. https://arxiv.org/html/2606.04660

## Mental-Health Safety and Crisis Handling

Mio should not claim therapeutic efficacy. The safety framing should say that crisis detection is a conservative guardrail and that the system is not a medical device or replacement for professional care. Woebot is useful as a contrast: it evaluates a constrained CBT-oriented conversational agent in a randomized controlled trial, while Mio is an open-ended companion architecture and has no clinical validation.

Recent LLM mental-health safety work shows that crisis handling requires annotated taxonomies, multi-turn evaluation, and expert review. Mio's current keyword-based red/yellow crisis layer is an engineering safety floor, not evidence of clinical safety.

Key sources:

- Fitzpatrick, K. K., Darcy, A., & Vierhile, M. (2017). Delivering Cognitive Behavior Therapy to Young Adults With Symptoms of Depression and Anxiety Using a Fully Automated Conversational Agent (Woebot): A Randomized Controlled Trial. JMIR Mental Health, 4(2), e19. https://mental.jmir.org/2017/2/e19/
- Between Help and Harm: An Evaluation Study of Mental Health Crisis Handling by Large Language Models. JMIR Mental Health 2026. https://mental.jmir.org/2026/1/e88435
- MHSafeEval: Role-Aware Interaction-Level Evaluation of Mental Health Safety in Large Language Models. Findings of ACL 2026. ACL Anthology page/PDF should be verified before final citation.

## Gap Mio Can Claim

The related work suggests a narrow but defensible gap:

> Existing work often evaluates memory, persona, emotional support, or crisis safety separately. Mio studies a working companion-agent architecture where these state channels are coupled in one turn loop and ablated across a multi-dimensional companion benchmark.

This should be the paper's main positioning. The current evidence is strongest for architecture and reproducible engineering evaluation, not for human-perceived companionship quality.
