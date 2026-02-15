// Тестовый TSX файл для проверки TSX loader
// tests/test_data/tsx/TestComponent.tsx

import React, { useState, useEffect, useCallback, memo, forwardRef } from 'react';
import { Button } from './Button';
import type { UserProps } from './types';

/**
 * Props интерфейс для TestComponent
 */
interface TestComponentProps {
  title: string;
  count?: number;
  onAction: () => void;
}

/**
 * Type alias для стилей
 */
type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Кастомный хук для работы с локальным состоянием
 */
function useLocalState<T>(initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  
  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  return { value, setValue, reset };
}

/**
 * Основной функциональный компонент
 */
function TestComponent({ title, count = 0, onAction }: TestComponentProps) {
  const { value, setValue } = useLocalState(count);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    console.log('Component mounted');
    return () => console.log('Component unmounted');
  }, []);

  const handleClick = useCallback(() => {
    setIsLoading(true);
    onAction();
    setValue(prev => prev + 1);
  }, [onAction, setValue]);

  return (
    <div className="test-component">
      <h1>{title}</h1>
      <span>Count: {value}</span>
      <Button onClick={handleClick} disabled={isLoading}>
        Click me
      </Button>
      <ChildComponent name="test" />
    </div>
  );
}

/**
 * Дочерний компонент как arrow function
 */
const ChildComponent: React.FC<{ name: string }> = ({ name }) => {
  return <span>Hello, {name}!</span>;
};

/**
 * Компонент с forwardRef
 */
const ForwardedInput = forwardRef<HTMLInputElement, { label: string }>(
  ({ label }, ref) => {
    return (
      <label>
        {label}
        <input ref={ref} type="text" />
      </label>
    );
  }
);

/**
 * Мемоизированный компонент
 */
const MemoizedDisplay = memo(function Display({ text }: { text: string }) {
  return <p>{text}</p>;
});

/**
 * Класс-компонент (legacy)
 */
class ClassComponent extends React.Component<{ message: string }> {
  state = { clicked: false };

  handleClick = () => {
    this.setState({ clicked: true });
  };

  render() {
    return (
      <div onClick={this.handleClick}>
        {this.props.message}
        {this.state.clicked && <span>Clicked!</span>}
      </div>
    );
  }
}

export default TestComponent;
export { ChildComponent, ForwardedInput, MemoizedDisplay, ClassComponent, useLocalState };
export type { TestComponentProps, ButtonVariant };
