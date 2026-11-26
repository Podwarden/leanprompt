package worker

import (
	"context"
	"errors"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// The SDK retries transient errors itself; the timeout fits long outputs.
var client = anthropic.NewClient(option.WithRequestTimeout(0), option.WithMaxRetries(3))

const instructions = "Summarise the ticket in three sentences."

func Summarise(ctx context.Context, tools []anthropic.ToolUnionParam, ticket string) (string, error) {
	stream := client.Messages.NewStreaming(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_5,
		MaxTokens: 4096,
		System: []anthropic.TextBlockParam{{
			Text:         instructions,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		}},
		Messages: []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(ticket))},
		Tools:    tools, // built once at start-up in a fixed order
	})
	msg := anthropic.Message{}
	for stream.Next() {
		if err := msg.Accumulate(stream.Current()); err != nil {
			return "", err
		}
	}
	if err := stream.Err(); err != nil {
		return "", err
	}
	if msg.StopReason == anthropic.StopReasonMaxTokens {
		return "", errors.New("summary truncated; raise MaxTokens instead of retrying")
	}
	return msg.Content[0].Text, nil
}
