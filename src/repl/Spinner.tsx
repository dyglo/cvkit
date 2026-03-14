import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import chalk from 'chalk';

const teal = chalk.hex('#4ecdc4');

const FRAMES = [
  '● Thinking...',
  'Thinking...',
  'Working...',
  'Analyzing...',
  'Processing...',
  'Flibbertigibbeting...',
  'Flummoxing...',
  'Ruminating...',
  'Contemplating...',
  'Lollygagging...'
] as const;

export function Spinner(): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % FRAMES.length);
    }, 400);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return <Text>{teal(FRAMES[index])}</Text>;
}
