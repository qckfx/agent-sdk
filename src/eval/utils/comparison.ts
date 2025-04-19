/**
 * Configuration comparison utilities for A/B testing
 */

import { AgentConfiguration, ConfigurationComparison } from '../models/ab-types.js';
import { ModelProvider } from '../runners/judge.js';
import { createLogger, LogLevel } from '../../utils/logger.js';

// Create a logger for comparison operations
const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'ConfigCompare'
});

/**
 * Compare two configurations based on their average judgment scores
 * 
 * @param configA First configuration to compare
 * @param configB Second configuration to compare
 * @param scoresA Average judgment scores for configuration A
 * @param scoresB Average judgment scores for configuration B
 * @param modelProvider Provider for LLM to analyze the comparison
 * @returns Comparison result with winner, analysis, and score differences
 */
export async function compareConfigurations(
  configA: AgentConfiguration,
  configB: AgentConfiguration,
  scoresA: Record<string, number>,
  scoresB: Record<string, number>,
  modelProvider: ModelProvider
): Promise<ConfigurationComparison | null> {
  try {
    logger.info(`Comparing configurations: ${configA.name} vs ${configB.name}`);
    
    // Create a tool difference description if tool sets differ
    let toolDifference = '';
    let hasToolDifferences = false;
    
    if (configA.availableTools || configB.availableTools) {
      const toolsA = configA.availableTools ? 
        (Array.isArray(configA.availableTools) ? configA.availableTools.join(', ') : String(configA.availableTools)) : 
        'all tools';
      
      const toolsB = configB.availableTools ? 
        (Array.isArray(configB.availableTools) ? configB.availableTools.join(', ') : String(configB.availableTools)) : 
        'all tools';
      
      // Check if tool sets are different
      if (toolsA !== toolsB) {
        hasToolDifferences = true;
        
        toolDifference = `
## Tool Availability
Configuration A tools: ${toolsA}
Configuration B tools: ${toolsB}
`;
        
        // Identify specific tool differences if arrays are provided
        if (Array.isArray(configA.availableTools) && Array.isArray(configB.availableTools)) {
          const uniqueToB = configB.availableTools.filter(tool => !configA.availableTools!.includes(tool));
          if (uniqueToB.length > 0) {
            toolDifference += `\nTools unique to Configuration B: ${uniqueToB.join(', ')}`;
          }
          
          const uniqueToA = configA.availableTools.filter(tool => !configB.availableTools!.includes(tool));
          if (uniqueToA.length > 0) {
            toolDifference += `\nTools unique to Configuration A: ${uniqueToA.join(', ')}`;
          }
        }
      }
    }

    // Create a comparison prompt
    const comparisonPrompt = `
# Configuration Comparison

I need you to compare two AI agent configurations based on their average judgment scores across multiple test runs.

## Configuration A: ${configA.name}
\`\`\`json
${JSON.stringify(scoresA, null, 2)}
\`\`\`

## Configuration B: ${configB.name}
\`\`\`json
${JSON.stringify(scoresB, null, 2)}
\`\`\`
${toolDifference}

Please analyze these scores and determine which configuration performed better overall.
Consider the following in your analysis:
1. Compare scores for each dimension
2. Calculate the overall difference and percentage improvement
3. Identify dimensions where the difference is most significant
${hasToolDifferences ? '4. Consider how tool availability differences might have affected the results' : ''}
${hasToolDifferences ? '5' : '4'}. Provide a clear assessment of which configuration is superior and by how much

${hasToolDifferences ? 'When analyzing the "Tool Usage" dimension, pay special attention to the different tool sets available to each configuration.' : ''}

Format your response as a JSON object with the following structure:
\`\`\`json
{
  "winner": "A" or "B" (or "tie" if they are equal),
  "analysis": "Your detailed analysis explaining the comparison",
  "scoreDifferences": {
    "dimension1": number (B's score minus A's score),
    "dimension2": number,
    ...
  },
  "overallImprovement": number (percentage improvement of B over A),
  "significantDimensions": [
    { "name": "dimension1", "difference": number, "percentageChange": number },
    ...
  ]
}
\`\`\`
`;
    
    // Run the comparison
    const result = await modelProvider.processQuery(comparisonPrompt, {
      temperature: 0.2,
      maxTokens: 2000
    });
    
    // Parse the result
    if (result.response) {
      try {
        // Extract JSON from the response
        const jsonMatch = result.response.match(/```json\n([\s\S]*?)\n```/) || 
                          result.response.match(/{[\s\S]*}/);
        
        if (jsonMatch) {
          const jsonContent = jsonMatch[1] || jsonMatch[0];
          return JSON.parse(jsonContent.trim());
        }
      } catch (parseError) {
        logger.error('Failed to parse configuration comparison result', parseError);
      }
    }
    
    // Manual comparison if automated comparison fails
    const scoreDifferences: Record<string, number> = {};
    let overallDifference = 0;
    
    // Calculate differences for each dimension
    const dimensions = Array.from(new Set([...Object.keys(scoresA), ...Object.keys(scoresB)]));
    for (const dimension of dimensions) {
      if (dimension === 'overall') continue;
      
      const scoreA = scoresA[dimension] || 0;
      const scoreB = scoresB[dimension] || 0;
      scoreDifferences[dimension] = scoreB - scoreA;
      overallDifference += scoreB - scoreA;
    }
    
    // Determine winner
    const dimensionCount = dimensions.filter(d => d !== 'overall').length;
    const avgDifference = dimensionCount > 0 ? overallDifference / dimensionCount : 0;
    const winner = avgDifference > 0.1 ? 'B' : (avgDifference < -0.1 ? 'A' : 'tie');
    
    // Calculate overall improvement percentage
    const overallImprovement = scoresA.overall ? (avgDifference / scoresA.overall) * 100 : 0;

    // Find significant dimensions (those with more than 5% difference)
    const significantDimensions = Object.entries(scoreDifferences)
      .filter(([dim, diff]) => dim !== 'overall' && Math.abs(diff) > 0.2)
      .map(([name, difference]) => {
        const baseScore = scoresA[name] || 1;
        const percentageChange = (difference / baseScore) * 100;
        return { name, difference, percentageChange };
      })
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
      .slice(0, 3); // Top 3 most significant differences
    
    return {
      winner,
      analysis: `Configuration ${winner === 'tie' ? 'A and B performed similarly' : winner + ' performed better overall'}. Average score difference: ${avgDifference.toFixed(2)}.`,
      scoreDifferences,
      overallImprovement,
      significantDimensions
    };
  } catch (error) {
    logger.error('Error comparing configurations', error);
    return null;
  }
}