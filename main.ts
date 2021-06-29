import { html, render } from 'lit-html';
import { assign, createMachine, interpret, send } from 'xstate';
import { createModel } from 'xstate/lib/model';
import Navaid from 'navaid';

// import { inspect } from "@xstate/inspect";
// inspect({ iframe: false });

type Todo = {
  id: number;
  content: string;
  completed: boolean;
};

const todosModel = createModel(
  {
    selectedTodo: null as Todo | null,
    todos: [{ id: 1, content: 'Foo', completed: false }] as Todo[],
  },
  {
    events: {
      navigateToNewTodo: () => ({}),
      navigateToTodos: () => ({}),
      navigateToTodo: (id: number) => ({ id }),
      pushNewTodo: () => ({}),
      pushTodos: () => ({}),
      pushTodo: (id: number) => ({ id }),
      routeNotFound: () => ({}),
      addNewTodo: (content: string) => ({ content }),
      removeTodo: (id: number) => ({ id }),
      toggleTodo: (id: number) => ({ id }),
    },
  }
);

const todosMachine = createMachine<typeof todosModel>(
  {
    id: 'todos',
    context: todosModel.initialContext,
    invoke: { src: 'router' },
    initial: 'routes',
    states: {
      // Need to create unnecessary nested state to avoid infinite loop with router being re-invoked by root transitions.
      // https://github.com/davidkpiano/xstate/pull/2149
      routes: {
        initial: 'idle',
        states: {
          // wait for initial navigation
          idle: {},
          todos: {
            tags: 'todos',
            entry: send('pushTodos', { to: 'router' }),
            on: {
              removeTodo: { actions: 'removeTodo' },
              toggleTodo: { actions: 'toggleTodo' },
            },
          },
          todo: {
            initial: 'validating',
            states: {
              validating: {
                always: [
                  {
                    cond: 'isValidTodo',
                    target: 'valid',
                    actions: 'assignSelectedTodo',
                  },
                  { target: 'error' },
                ],
              },
              valid: {
                tags: 'todo',
                entry: send(
                  (context) => ({
                    type: 'pushTodo',
                    id: context.selectedTodo.id,
                  }),
                  {
                    to: 'router',
                  }
                ),
                on: {
                  navigateToTodo: undefined, // prevent infinite navigation feedback loop due to transient transition
                  toggleTodo: { actions: 'toggleTodo' },
                  removeTodo: {
                    target: '#todos.routes.todos',
                    actions: 'removeTodo',
                  },
                },
              },
              error: { tags: 'invalid-todo' },
            },
          },
          new: {
            tags: 'new-todo',
            entry: send('pushNewTodo', { to: 'router' }),
            on: {
              addNewTodo: {
                cond: 'isContentValid',
                target: 'todos',
                actions: 'assignNewTodo',
              },
            },
          },
          notFound: { tags: 'not-found' },
        },
        on: {
          navigateToTodos: '.todos',
          navigateToNewTodo: '.new',
          navigateToTodo: '.todo',
          routeNotFound: '.notFound',
        },
      },
    },
  },
  {
    actions: {
      assignNewTodo: assign({
        todos: (context, event) => {
          if (event.type !== 'addNewTodo') return context.todos;
          const id = context.todos.reduce((acc, todo) => Math.max(acc, todo.id), 0) + 1;
          return [...context.todos, { id, content: event.content, completed: false }];
        },
      }),
      removeTodo: assign({
        todos: (context, event) => {
          if (event.type !== 'removeTodo') return context.todos;

          const index = context.todos.findIndex((todo) => todo.id === event.id);
          context.todos.splice(index, 1);
          return context.todos;
        },
      }),
      toggleTodo: assign({
        todos: (context, event) => {
          if (event.type !== 'toggleTodo') return context.todos;

          const todo = context.todos.find((todo) => todo.id === event.id);
          if (todo !== undefined) {
            todo.completed = !todo.completed;
          }
          return context.todos;
        },
      }),
      assignSelectedTodo: assign({
        // Use meta event as workaround to https://github.com/davidkpiano/xstate/issues/890
        selectedTodo: (context, _, meta) => {
          const { event } = meta.state || {};
          if (event === undefined || event.type !== 'navigateToTodo') return context.selectedTodo;
          const todo = context.todos.find((todo) => todo.id === event.id);
          return todo || context.selectedTodo;
        },
      }),
      removeSelectedTodo: assign({
        selectedTodo: (context) => null,
      }),
    },
    guards: {
      // Use meta event as workaround to https://github.com/davidkpiano/xstate/issues/890
      isValidTodo: (context, _, meta) => {
        const { event } = meta.state;
        if (event.type !== 'navigateToTodo') return false;
        return !!context.todos.find((todo) => todo.id === event.id);
      },
      isContentValid: (context, event) => {
        if (event.type !== 'addNewTodo') return false;
        return event.content.length > 0;
      },
    },
    services: {
      router: () => (sendBack, receive) => {
        const router = Navaid('/', () => sendBack('routeNotFound'));

        // Deserialize events from the URL
        router
          .on('/', () => sendBack('navigateToTodos'))
          .on('/todos', () => sendBack('navigateToTodos'))
          .on('/todo/new', () => sendBack('navigateToNewTodo'))
          .on('/todo/:id', (params) =>
            sendBack(todosModel.events.navigateToTodo(Number(params.id)))
          );

        // Serialize current state to URL
        receive((event) => {
          if (event.type === 'pushTodos') {
            router.route('/todos');
          } else if (event.type === 'pushTodo') {
            router.route(`/todo/${event.id}`);
          } else if (event.type === 'pushNewTodo') {
            router.route(`/todo/new`);
          }
        });

        router.listen();

        return () => router.unlisten();
      },
    },
  }
);

const el = document.getElementById('app')!;
const service = interpret(todosMachine, { devTools: true }).start();

function todoComponent(todo: Todo) {
  const id = `todo-${todo.id}`;
  return html`
    <div class="flex items-center gap-2 ${todo.completed ? 'text-gray-400' : ''}">
      <input
        id="${id}"
        name="${todo}"
        type="checkbox"
        class="h-4 w-4"
        .value="${todo.completed}"
        @click="${() => service.send(todosModel.events.toggleTodo(todo.id))}"
      />
      <label for="${id}" class="font-medium ${todo.completed ? 'line-through ' : ''}"
        >${todo.content}</label
      >
      <a class="underline ${todo.completed ? '' : 'text-gray-700'}" href="${`/todo/${todo.id}`}"
        >(Link)</a
      >
      <button
        class="${todo.completed ? '' : 'text-gray-700'}"
        @click="${() => service.send(todosModel.events.removeTodo(todo.id))}"
      >
        X
      </button>
    </div>
  `;
}

function viewTodos(todos: Todo[]) {
  return html`
    <div class="flex gap-4 ">
      <h1 class="text-base font-medium text-gray-900">Todos</h1>
      <a class="underline" href="/todo/new">New</a>
    </div>
    ${todos.length === 0
      ? html` <h2 class="text-gray-400">No todos</h2> `
      : html` <ol>
          ${todos.map((todo) => html`<li>${todoComponent(todo)}</li>`)}
        </ol>`}
  `;
}

function viewTodo(todo: Todo) {
  return html`
    <div class="flex gap-4 ">
      <h1 class="text-base font-medium text-gray-900">Todo ${todo.id}</h1>
      <a class="underline" href="/todos">Todos</a>
    </div>
    ${todoComponent(todo)}
  `;
}

function viewInvalidTodo() {
  return html`
    <div class="flex gap-4 ">
      <h1 class="text-base font-medium text-gray-900">Todo invalid</h1>
      <a class="underline" href="/todos">Go back to todos</a>
    </div>
  `;
}

function viewNewTodo() {
  let content = '';
  return html`
    <div class="flex gap-4">
      <h1>Add new todo</h1>
      <a class="underline" href="/todos">Todos</a>
    </div>
    <input
      type="text"
      placeholder="Something on you mind?"
      class="w-72"
      .value="${content}"
      @input="${(e: InputEvent) => (content = (e.target as HTMLInputElement).value)}"
    />
    <button @click="${() => service.send(todosModel.events.addNewTodo(content))}">Add!</button>
  `;
}

function viewNotFound() {
  return html`
    <h1>404 | Not found</h1>
    <a class="underline" href="/todos">Go back to todos</a>
  `;
}

// Map current state to what to render, the view should not care about what the URL is at all
service.onTransition((state) => {
  if (state.hasTag('todos')) {
    render(viewTodos(state.context.todos), el);
  } else if (state.hasTag('new-todo')) {
    render(viewNewTodo(), el);
  } else if (state.hasTag('todo') && state.context.selectedTodo) {
    render(viewTodo(state.context.selectedTodo), el);
  } else if (state.hasTag('invalid-todo')) {
    render(viewInvalidTodo(), el);
  } else if (state.hasTag('not-found')) {
    render(viewNotFound(), el);
  }
});
