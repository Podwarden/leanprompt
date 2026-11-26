package worker

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

var client = anthropic.NewClient(option.WithRequestTimeout(8 * time.Second))

const instructions = "Summarise the ticket in three sentences."

func Summarise(ctx context.Context, tools map[string]anthropic.ToolParam, ticket string) (string, error) {
	wd, _ := os.Getwd()
	system := fmt.Sprintf("agent cwd %s\n%s", wd, instructions)
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		msg, err := client.Messages.New(ctx, anthropic.MessageNewParams{
			Model:     anthropic.ModelClaudeSonnet4_5,
			MaxTokens: 4096,
			System:    []anthropic.TextBlockParam{{Text: system}},
			Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(ticket))},
			Tools:     toolUnions(tools),
		})
		if err != nil {
			lastErr = err
			continue
		}
		return msg.Content[0].Text, nil
	}
	return "", lastErr
}

func toolUnions(byName map[string]anthropic.ToolParam) []anthropic.ToolUnionParam {
	var out []anthropic.ToolUnionParam
	for _, t := range byName {
		out = append(out, anthropic.ToolUnionParam{OfTool: &t})
	}
	return out
}
